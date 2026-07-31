// server.js — бэкенд UMAR с простой регистрацией (ник + пароль)
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
const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Multer для аватаров
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/avatars';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ---------- БАЗА ДАННЫХ ----------
const db = new sqlite3.Database('./umar.db');

db.serialize(() => {
    // Таблица пользователей (упрощённая)
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            name TEXT,
            avatar TEXT,
            bio TEXT,
            last_seen INTEGER,
            is_online INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // Таблица чатов
    db.run(`
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            name TEXT,
            is_group INTEGER DEFAULT 0,
            avatar TEXT,
            color TEXT,
            created_at INTEGER
        )
    `);

    // Участники чатов
    db.run(`
        CREATE TABLE IF NOT EXISTS chat_members (
            chat_id TEXT,
            user_id TEXT,
            is_admin INTEGER DEFAULT 0,
            joined_at INTEGER,
            PRIMARY KEY (chat_id, user_id)
        )
    `);

    // Сообщения
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT,
            sender_id TEXT,
            text TEXT,
            file TEXT,
            voice TEXT,
            reply_to TEXT,
            is_edited INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // Контакты
    db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
            user_id TEXT,
            contact_id TEXT,
            created_at INTEGER,
            PRIMARY KEY (user_id, contact_id)
        )
    `);

    // Создаём Матвея
    db.get('SELECT * FROM users WHERE id = ?', ['matvey'], (err, row) => {
        if (!row) {
            const hashedPass = bcrypt.hashSync('matvey123', 10);
            db.run(`
                INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'matvey',
                'matvey',
                hashedPass,
                'Матвей',
                'М',
                'Казино-бот 🎰',
                1,
                Date.now()
            ]);
        }
    });

    // Создаём тестовых пользователей
    const testUsers = [
        { id: 'anna', username: 'anna', name: 'Анна', avatar: 'А', color: '#b36b9e' },
        { id: 'bob', username: 'bob', name: 'Боб', avatar: 'Б', color: '#4f9e6a' },
        { id: 'elena', username: 'elena', name: 'Елена', avatar: 'Е', color: '#d65f5f' },
        { id: 'mike', username: 'mike', name: 'Михаил', avatar: 'М', color: '#b3804a' }
    ];

    testUsers.forEach(user => {
        db.get('SELECT * FROM users WHERE id = ?', [user.id], (err, row) => {
            if (!row) {
                const hashedPass = bcrypt.hashSync('123456', 10);
                db.run(`
                    INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    user.id,
                    user.username,
                    hashedPass,
                    user.name,
                    user.avatar,
                    'Тестовый пользователь',
                    1,
                    Date.now()
                ]);
            }
        });
    });
});

// ---------- API ЭНДПОИНТЫ ----------

// 1. РЕГИСТРАЦИЯ (только username + пароль)
app.post('/api/auth/register', async (req, res) => {
    const { username, password, name } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    if (username.length < 3) {
        return res.status(400).json({ error: 'Логин должен быть минимум 3 символа' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }

    try {
        const hashedPass = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        const displayName = name || username;

        db.run(
            `INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, username, hashedPass, displayName, '👤', 'Новый пользователь', 1, Date.now(), Date.now()],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Логин уже занят' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({ 
                    success: true, 
                    user: { id: userId, username, name: displayName, avatar: '👤', bio: 'Новый пользователь' }
                });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. ЛОГИН (только username + пароль)
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: 'Неверный пароль' });

        db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);

        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                username: user.username, 
                name: user.name, 
                avatar: user.avatar, 
                bio: user.bio,
                is_online: user.is_online
            } 
        });
    });
});

// 3. ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО USERNAME
app.get('/api/users/search/:query', (req, res) => {
    const { query } = req.params;
    db.all(
        'SELECT id, username, name, avatar, bio, is_online FROM users WHERE username LIKE ? OR name LIKE ?',
        [`%${query}%`, `%${query}%`],
        (err, users) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(users.filter(u => u.id !== 'matvey'));
        }
    );
});

// 4. ПОЛУЧЕНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (для добавления в группы)
app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, name, avatar, bio, is_online FROM users', (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users);
    });
});

// 5. ПОЛУЧЕНИЕ ПРОФИЛЯ
app.get('/api/users/:userId', (req, res) => {
    const { userId } = req.params;
    db.get('SELECT id, username, name, avatar, bio, is_online, last_seen FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(user);
    });
});

// 6. ОБНОВЛЕНИЕ ПРОФИЛЯ
app.post('/api/users/profile', upload.single('avatar'), (req, res) => {
    const { userId, name, bio } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId обязателен' });

    let avatar = req.body.avatar;
    if (req.file) {
        avatar = `/uploads/avatars/${req.file.filename}`;
    }

    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (avatar) { updates.push('avatar = ?'); params.push(avatar); }

    if (updates.length === 0) return res.json({ success: true });

    params.push(userId);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 7. КОНТАКТЫ
app.post('/api/contacts', (req, res) => {
    const { userId, contactId } = req.body;
    if (!userId || !contactId) return res.status(400).json({ error: 'ID обязательны' });

    db.run('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)',
        [userId, contactId, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.get('/api/contacts/:userId', (req, res) => {
    const { userId } = req.params;
    db.all(`
        SELECT u.* FROM users u
        JOIN contacts c ON c.contact_id = u.id
        WHERE c.user_id = ?
    `, [userId], (err, contacts) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(contacts);
    });
});

// 8. ЧАТЫ
app.post('/api/chats', (req, res) => {
    const { name, isGroup, members, creatorId } = req.body;
    if (!members || !members.length) return res.status(400).json({ error: 'Участники обязательны' });

    const chatId = uuidv4();
    const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');

    db.run(
        'INSERT INTO chats (id, name, is_group, avatar, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [chatId, name || (isGroup ? 'Группа' : members[0]), isGroup ? 1 : 0, isGroup ? '👥' : '👤', color, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });

            const stmt = db.prepare('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)');
            members.forEach(m => {
                const isAdmin = m === creatorId ? 1 : 0;
                stmt.run(chatId, m, isAdmin, Date.now());
            });
            stmt.finalize();

            if (isGroup && !members.includes('matvey')) {
                db.run('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)',
                    [chatId, 'matvey', 0, Date.now()]);
            }

            res.json({ success: true, chatId });
        }
    );
});

app.get('/api/chats/:userId', (req, res) => {
    const { userId } = req.params;
    db.all(`
        SELECT c.*, 
               (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count,
               (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id) as members
        FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id
        WHERE cm.user_id = ?
    `, [userId], (err, chats) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(chats);
    });
});

// 9. СООБЩЕНИЯ
app.get('/api/messages/:chatId', (req, res) => {
    const { chatId } = req.params;
    db.all(`
        SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
    `, [chatId], (err, messages) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(messages);
    });
});

// ---------- SOCKET.IO ----------
const onlineUsers = new Set();

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    if (userId) {
        onlineUsers.add(userId);
        db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), userId]);
        io.emit('user_status', { userId, status: 'online' });
    }

    socket.on('send_message', async (data) => {
        const { chatId, senderId, text, file, voice, replyTo } = data;
        const msgId = uuidv4();

        db.run(`
            INSERT INTO messages (id, chat_id, sender_id, text, file, voice, reply_to, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [msgId, chatId, senderId, text || '', file || null, voice || null, replyTo || null, Date.now()],
        (err) => {
            if (err) return socket.emit('error', err.message);

            db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, members) => {
                if (err) return;
                members.forEach(m => {
                    if (m.user_id !== senderId) {
                        io.to(m.user_id).emit('new_message', { chatId, msgId, senderId, text, file, voice, replyTo });
                    }
                });
            });
        });
    });

    socket.on('typing', ({ chatId, userId }) => {
        db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, members) => {
            if (err) return;
            members.forEach(m => {
                if (m.user_id !== userId) {
                    io.to(m.user_id).emit('user_typing', { chatId, userId });
                }
            });
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

// ---------- ЗАПУСК ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 UMAR сервер запущен на порту ${PORT}`);
    console.log('📝 Тестовые пользователи: anna/bob/elena/mike (пароль: 123456)');
});
