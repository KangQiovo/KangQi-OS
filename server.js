const express = require('express');
const fs = require('fs');
const path = require('path');
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
const userInfoMap = new Map(); // sessionId -> user info
const pendingFriendRequests = new Map(); // targetId -> Set<fromId>
const pendingFriendResponses = new Map(); // targetId -> Array<{ from, accepted }>
const guestDailyQuota = new Map(); // sessionId -> { date: 'YYYY-MM-DD', count }

const HISTORY_FILE = path.join(__dirname, 'chat-history.json');
const HISTORY_RETENTION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

let history = [];

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
            history = JSON.parse(raw) || [];
        }
    } catch (e) {
        console.error('读取聊天记录失败:', e);
        history = [];
    }
    pruneHistory();
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
        console.error('保存聊天记录失败:', e);
    }
}

function pruneHistory() {
    const now = Date.now();
    history = history.filter(m => now - m.timestamp <= HISTORY_RETENTION_MS);
    saveHistory();
}

loadHistory();
setInterval(pruneHistory, 30 * 60 * 1000);

function generateSessionId(ua = '') {
    let hash = 0;
    if (!ua || ua.length === 0) return hash.toString();
    for (let i = 0; i < ua.length; i++) {
        hash = ((hash << 5) - hash) + ua.charCodeAt(i);
        hash |= 0; // 强制 32 位
    }
    return Math.abs(hash).toString(16).substring(0, 7);
}

function normalizeIdentity(raw) {
    if (!raw || typeof raw !== 'object') return { userType: 'guest', sessionId: generateSessionId('') };
    const sessionId = typeof raw.sessionId === 'string' && raw.sessionId.trim()
        ? raw.sessionId.trim()
        : generateSessionId(raw.userAgent || '');
    const userType = raw.userType === 'member' ? 'member' : 'guest';
    const displayName = raw.displayName || (userType === 'member' ? `KangQi用户-${sessionId.slice(0, 4)}` : `游客-${sessionId.slice(0, 4)}`);
    return {
        sessionId,
        userType,
        displayName,
        deviceInfo: raw.deviceInfo || '未知设备',
        location: raw.location || '中国四川',
    };
}

function canGuestSend(sessionId) {
    const today = new Date().toISOString().slice(0, 10);
    const info = guestDailyQuota.get(sessionId) || { date: today, count: 0 };
    if (info.date !== today) {
        info.date = today;
        info.count = 0;
    }
    if (info.count >= 10) return false;
    info.count += 1;
    guestDailyQuota.set(sessionId, info);
    return true;
}

function buildMessage({ from, to = null, channel = 'public', payload, meta = {} }) {
    return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        from,
        to,
        channel,
        payload,
        meta,
        timestamp: Date.now(),
    };
}

io.on('connection', (socket) => {
    const ua = socket.handshake.headers['user-agent'] || '';
    const identity = normalizeIdentity({
        sessionId: socket.handshake.auth?.sessionId || socket.handshake.query?.sessionId,
        userType: socket.handshake.auth?.userType || socket.handshake.query?.userType,
        displayName: socket.handshake.auth?.displayName || socket.handshake.query?.displayName,
        deviceInfo: socket.handshake.auth?.deviceInfo || socket.handshake.query?.deviceInfo || ua,
        location: socket.handshake.auth?.location || socket.handshake.query?.location,
        userAgent: ua,
    });

    const sessionId = identity.sessionId;
    sessionMap.set(sessionId, socket.id);
    userInfoMap.set(sessionId, identity);

    // 补发离线期间收到的好友请求，并同步当前待处理请求快照
    const replayPendingRequests = () => {
        const offlineRequests = pendingFriendRequests.get(sessionId);
        if (offlineRequests && offlineRequests.size > 0) {
            offlineRequests.forEach((fromId) => {
                socket.emit('friend request received', { from: fromId });
            });
        }
        socket.emit('pending friend requests', {
            fromIds: Array.from(pendingFriendRequests.get(sessionId) || [])
        });
    };

    replayPendingRequests();

    // 补发离线期间收到的好友响应（处理完后清除）
    const offlineResponses = pendingFriendResponses.get(sessionId);
    if (offlineResponses && offlineResponses.length > 0) {
        offlineResponses.forEach(({ from, accepted }) => {
            socket.emit('friend response received', { from, accepted });
        });
        pendingFriendResponses.delete(sessionId);
    }

    // 1. 发送用户的 ID 给自己
    socket.emit('session info', { id: sessionId, userType: identity.userType, displayName: identity.displayName, deviceInfo: identity.deviceInfo, location: identity.location });
    socket.emit('chat history', { messages: history });

    // 2. 公共聊天广播 (兼容旧事件 "chat message")
    const broadcastPublic = (payload) => {
        const msg = buildMessage({
            from: sessionId,
            channel: 'public',
            payload,
            meta: identity,
        });
        history.push(msg);
        pruneHistory();
        io.emit('public message', msg);
    };

    socket.on('public message', (msg) => {
        if (!msg?.payload) return;
        if (identity.userType === 'guest' && !canGuestSend(sessionId)) {
            socket.emit('quota exceeded');
            return;
        }
        broadcastPublic(msg.payload);
    });

    socket.on('chat message', (text) => {
        if (!text) return;
        if (identity.userType === 'guest' && !canGuestSend(sessionId)) {
            socket.emit('quota exceeded');
            return;
        }
        broadcastPublic({ type: 'text', text });
    });

    // 3. 私聊消息转发
    socket.on('private message', ({ payload, to }) => {
        const targetSocketId = sessionMap.get(to);
        if (!targetSocketId) return;

        if (identity.userType === 'guest' && !canGuestSend(sessionId)) {
            socket.emit('quota exceeded');
            return;
        }

        const msg = buildMessage({ from: sessionId, to, channel: 'private', payload, meta: identity });
        history.push(msg);
        pruneHistory();
        socket.to(targetSocketId).emit('private message', msg);
        socket.emit('private message', msg); // 回显给自己，保持一致
    });

    socket.on('recall message', ({ messageId }) => {
        if (!messageId) return;
        const record = history.find(m => m.id === messageId);
        if (!record) return;
        if (record.from !== sessionId) return;
        const withinWindow = Date.now() - record.timestamp <= 2 * 60 * 1000;
        if (!withinWindow) return;
        record.recalled = true;
        record.payload = { type: 'recalled', text: '已撤回' };
        saveHistory();
        if (record.channel === 'public') {
            io.emit('message recalled', { messageId });
        } else if (record.to) {
            const targetSocketId = sessionMap.get(record.to);
            if (targetSocketId) {
                socket.to(targetSocketId).emit('message recalled', { messageId });
            }
            socket.emit('message recalled', { messageId });
        }
    });

    // 4. 好友请求处理
    socket.on('friend request', ({ to }) => {
        // 检查目标是否存在
        const targetSocketId = sessionMap.get(to);
        const targetSocket = targetSocketId && io.sockets.sockets.get(targetSocketId);

        // 无论对方是否在线，都先记录离线请求，供之后登录时读取
        const currentSet = pendingFriendRequests.get(to) || new Set();
        currentSet.add(sessionId);
        pendingFriendRequests.set(to, currentSet);

        if (targetSocket) {
            socket.to(targetSocketId).emit('friend request received', { from: sessionId });
            socket.to(targetSocketId).emit('pending friend requests', {
                fromIds: Array.from(currentSet)
            });
            socket.emit('request sent', { success: true, to });
        } else {
            socket.emit('request sent', { success: true, to });
        }
    });

    // 5. 好友响应处理
    socket.on('friend response', ({ to, accepted }) => {
        const targetSocketId = sessionMap.get(to);

        // 清理待处理请求，避免重复下发
        const targetRequests = pendingFriendRequests.get(sessionId);
        if (targetRequests) {
            targetRequests.delete(to);
            if (targetRequests.size === 0) pendingFriendRequests.delete(sessionId);
            else pendingFriendRequests.set(sessionId, targetRequests);
        }

        // 目标在线直接推送，离线则存入待响应列表
        if (targetSocketId) {
            socket.to(targetSocketId).emit('friend response received', {
                from: sessionId,
                accepted
            });
        } else {
            const responses = pendingFriendResponses.get(to) || [];
            responses.push({ from: sessionId, accepted });
            pendingFriendResponses.set(to, responses);
        }
    });

    socket.on('disconnect', () => {
        sessionMap.delete(sessionId);
        userInfoMap.delete(sessionId);
        // 简化：不广播离线，依赖前端重连
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`Server running at port ${PORT}`);
});
