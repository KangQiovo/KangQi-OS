const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*.kangqiovo.com",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    // 1. 发送用户的 ID 给自己
    socket.emit('session info', { id: socket.id });

    // 2. 公共聊天广播 (兼容旧事件 "chat message")
    const broadcastPublic = (text) => {
        io.emit('public message', {
            text,
            id: socket.id,
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
        // 发送给接收者
        socket.to(to).emit('private message', {
            content,
            from: socket.id
        });
        // 最好发回给自己确认（前端处理即可，或者后端发回也行）
    });

    // 4. 好友请求处理
    socket.on('friend request', ({ to }) => {
        // 检查目标是否存在
        const targetSocket = io.sockets.sockets.get(to);
        if (targetSocket) {
            socket.to(to).emit('friend request received', { from: socket.id });
            socket.emit('request sent', { success: true, to });
        } else {
            socket.emit('request sent', { success: false, msg: '用户离线或ID不存在' });
        }
    });

    // 5. 好友响应处理
    socket.on('friend response', ({ to, accepted }) => {
        socket.to(to).emit('friend response received', { 
            from: socket.id, 
            accepted 
        });
    });

    socket.on('disconnect', () => {
        // 通知所有可能的好友该用户下线 (简化版：由于没有数据库，前端socket断开即可)
        // 这里可以选择广播或者让前端自己处理心跳
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running at port ${PORT}`);
});
