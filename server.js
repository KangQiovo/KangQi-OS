const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    // 允许任意来源连接，方便将前端静态文件与 Socket 服务分域部署
    cors: {
        origin: '*',
        methods: ["GET", "POST"]
    }
});

const sessionMap = new Map();

function generateSessionId(ua = '') {
    let hash = 0;
    if (!ua || ua.length === 0) return hash.toString();
    for (let i = 0; i < ua.length; i++) {
        hash = ((hash << 5) - hash) + ua.charCodeAt(i);
        hash |= 0; // 强制 32 位
    }
    return Math.abs(hash).toString(16).substring(0, 7);
}

io.on('connection', (socket) => {
    // 优先使用客户端传入的 sessionId，若无则按 UA 生成
    const ua = socket.handshake.headers['user-agent'] || '';
    const providedSessionId = socket.handshake.auth?.sessionId || socket.handshake.query?.sessionId;
    const sessionId = (typeof providedSessionId === 'string' && providedSessionId.trim())
        ? providedSessionId.trim()
        : generateSessionId(ua);

    sessionMap.set(sessionId, socket.id);

    // 1. 发送用户的 ID 给自己
    socket.emit('session info', { id: sessionId });

    // 2. 公共聊天广播 (兼容旧事件 "chat message")
    const broadcastPublic = (text) => {
        io.emit('public message', {
            text,
            id: sessionId,
            username: "匿名用户"
        });
    };

    socket.on('public message', (msg) => {
        if (msg?.text) broadcastPublic(msg.text);
    });

    socket.on('chat message', (text) => {
        if (text) broadcastPublic(text);
    });

    // 3. 私聊消息转发
    socket.on('private message', ({ content, to }) => {
        const targetSocketId = sessionMap.get(to);
        if (!targetSocketId) return;

        // 发送给接收者
        socket.to(targetSocketId).emit('private message', {
            content,
            from: sessionId
        });
    });

    // 4. 好友请求处理
    socket.on('friend request', ({ to }) => {
        // 检查目标是否存在
        const targetSocketId = sessionMap.get(to);
        const targetSocket = targetSocketId && io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            socket.to(targetSocketId).emit('friend request received', { from: sessionId });
            socket.emit('request sent', { success: true, to });
        } else {
            socket.emit('request sent', { success: false, msg: '用户离线或ID不存在' });
        }
    });

    // 5. 好友响应处理
    socket.on('friend response', ({ to, accepted }) => {
        const targetSocketId = sessionMap.get(to);
        if (!targetSocketId) return;

        socket.to(targetSocketId).emit('friend response received', {
            from: sessionId,
            accepted
        });
    });

    socket.on('disconnect', () => {
        sessionMap.delete(sessionId);
        // 通知所有可能的好友该用户下线 (简化版：由于没有数据库，前端socket断开即可)
        // 这里可以选择广播或者让前端自己处理心跳
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running at port ${PORT}`);
});
