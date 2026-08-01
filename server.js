/// server.js — UMAR бэкенд (рабочая версия)
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// === CORS ===
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'], credentials: true }));
app.options('*', cors());

// === Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// === Multer для аватаров ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/avatars';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Только изображения'));
}});

// === База данных ===
const db = new sqlite3.Database('./umar.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, name TEXT, avatar TEXT, bio TEXT,
        last_seen INTEGER, is_online INTEGER DEFAULT 0, created_at INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY, name TEXT, is_group INTEGER DEFAULT 0, avatar TEXT, color TEXT, description TEXT, created_at INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS chat_members (
        chat_id TEXT, user_id TEXT, is_admin INTEGER DEFAULT 0, joined_at INTEGER, PRIMARY KEY (chat_id, user_id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, chat_id TEXT, sender_id TEXT, text TEXT, file TEXT, voice TEXT,
        reply_to TEXT, is_edited INTEGER DEFAULT 0, created_at INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        user_id TEXT, contact_id TEXT, created_at INTEGER, PRIMARY KEY (user_id, contact_id)
    )`);

    // Матвей
    db.get('SELECT * FROM users WHERE id = ?', ['matvey'], (err, row) => {
        if (!row) {
            const hashed = bcrypt.hashSync('matvey123', 10);
            db.run(`INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['matvey', 'matvey', hashed, 'Матвей', '/uploads/avatars/matvey.png', 'Казино-бот 🎰', 1, Date.now()]
            );
        }
    });
});

// === Генерация ID ===
function generateUserId(callback) {
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) return callback(err);
        callback(null, String((row.count || 0) + 1).padStart(5, '0'));
    });
}

// === РЕГИСТРАЦИЯ ===
app.post('/api/auth/register', upload.single('avatar'), async (req, res) => {
    const { username, password, name } = req.body;
    if (!username || !password || !req.file) return res.status(400).json({ error: 'Все поля обязательны' });
    if (username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Логин (3+) или пароль (6+)' });

    try {
        const hashed = await bcrypt.hash(password, 10);
        const avatarPath = `/uploads/avatars/${req.file.filename}`;
        generateUserId((err, userId) => {
            if (err) return res.status(500).json({ error: err.message });
            db.run(`INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, username, hashed, name || username, avatarPath, 'Новый пользователь', 1, Date.now(), Date.now()],
                function(err) {
                    if (err) return res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Логин занят' : err.message });
                    res.json({ success: true, user: { id: userId, username, name: name || username, avatar: avatarPath, bio: 'Новый пользователь' } });
                }
            );
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === ЛОГИН ===
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: err ? err.message : 'Пользователь не найден' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: 'Неверный пароль' });

        db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);
        res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, avatar: user.avatar, bio: user.bio, is_online: 1 } });
    });
});

// === ПОЛУЧЕНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ===
app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, name, avatar, bio, is_online FROM users WHERE id != ?', ['matvey'], (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users);
    });
});

// === ПОИСК ПОЛЬЗОВАТЕЛЕЙ ===
app.get('/api/users/search/:query', (req, res) => {
    const { query } = req.params;
    db.all('SELECT id, username, name, avatar, bio, is_online FROM users WHERE (username LIKE ? OR name LIKE ?) AND id != ?',
        [`%${query}%`, `%${query}%`, 'matvey'], (err, users) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(users);
        }
    );
});

// === ПОЛУЧЕНИЕ ПРОФИЛЯ ===
app.get('/api/users/:userId', (req, res) => {
    db.get('SELECT id, username, name, avatar, bio, is_online, last_seen FROM users WHERE id = ?', [req.params.userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: err ? err.message : 'Не найден' });
        res.json(user);
    });
});

// === КОНТАКТЫ — ДОБАВИТЬ ===
app.post('/api/contacts', (req, res) => {
    const { userId, contactId } = req.body;
    if (!userId || !contactId) return res.status(400).json({ error: 'ID обязательны' });
    db.run('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)',
        [userId, contactId, Date.now()], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// === КОНТАКТЫ — ПОЛУЧИТЬ ===
app.get('/api/contacts/:userId', (req, res) => {
    db.all(`SELECT u.id, u.username, u.name, u.avatar, u.bio, u.is_online FROM users u
        JOIN contacts c ON c.contact_id = u.id WHERE c.user_id = ?`, [req.params.userId], (err, contacts) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(contacts);
        }
    );
});

// === СОЗДАНИЕ ЧАТА ===
app.post('/api/chats', (req, res) => {
    const { name, isGroup, members, creatorId, description } = req.body;
    if (!members || !members.length) return res.status(400).json({ error: 'Участники обязательны' });

    const chatId = uuidv4();
    const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    db.run(`INSERT INTO chats (id, name, is_group, avatar, color, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [chatId, name || (isGroup ? 'Группа' : members[0]), isGroup ? 1 : 0, isGroup ? '👥' : '👤', color, description || '', Date.now()],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const stmt = db.prepare('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)');
            members.forEach(m => stmt.run(chatId, m, m === creatorId ? 1 : 0, Date.now()));
            stmt.finalize();
            if (isGroup && !members.includes('matvey')) {
                db.run('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)',
                    [chatId, 'matvey', 0, Date.now()]);
            }
            res.json({ success: true, chatId });
        }
    );
});

// === ЧАТЫ ПОЛЬЗОВАТЕЛЯ ===
app.get('/api/chats/:userId', (req, res) => {
    db.all(`SELECT c.*,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count,
        (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id) as members,
        (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id AND is_admin = 1) as admins
        FROM chats c JOIN chat_members cm ON cm.chat_id = c.id WHERE cm.user_id = ?`, [req.params.userId],
        (err, chats) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(chats);
        }
    );
});

// === СООБЩЕНИЯ ===
app.get('/api/messages/:chatId', (req, res) => {
    db.all(`SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id WHERE m.chat_id = ? ORDER BY m.created_at ASC LIMIT 100`,
        [req.params.chatId], (err, messages) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(messages);
        }
    );
});

// === SOCKET.IO ===
const io = socketIO(server, { cors: { origin: '*', methods: ['GET','POST'], credentials: true } });
const onlineUsers = new Set();

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    if (userId) {
        onlineUsers.add(userId);
        db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), userId]);
        io.emit('user_status', { userId, status: 'online' });
    }

    socket.on('send_message', (data) => {
        const { chatId, senderId, text, file, voice, replyTo } = data;
        const msgId = uuidv4();
        db.run(`INSERT INTO messages (id, chat_id, sender_id, text, file, voice, reply_to, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [msgId, chatId, senderId, text || '', file || null, voice || null, replyTo || null, Date.now()],
            function(err) {
                if (err) return socket.emit('error', err.message);
                db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, members) => {
                    if (err) return;
                    const msgData = { id: msgId, chatId, senderId, text: text || '', file: file || null, voice: voice || null, replyTo: replyTo || null, created_at: Date.now() };
                    members.forEach(m => {
                        if (m.user_id !== senderId) io.to(m.user_id).emit('new_message', msgData);
                    });
                    io.to(senderId).emit('message_sent', msgData);
                });
            }
        );
    });

    socket.on('typing', ({ chatId, userId }) => {
        db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, members) => {
            if (err) return;
            members.forEach(m => { if (m.user_id !== userId) io.to(m.user_id).emit('user_typing', { chatId, userId }); });
        });
    });

    socket.on('disconnect', () => {
        if (userId) {
            onlineUsers.delete(userId);
            db.run('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?', [Date.now(), userId]);
            io.emit('user_status', { userId, status: 'offline' });
        }
    });
});

// === ЗАПУСК ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 UMAR сервер запущен на порту ${PORT}`);
    console.log(`✅ База данных: ./umar.db`);
    console.log(`📁 Папка uploads: ./uploads`);
});
