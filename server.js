// server.js — бэкенд UMAR с регистрацией, логином и Socket.IO
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

// Multer для загрузки аватаров
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

// Схема базы данных
db.serialize(() => {
    // Таблица пользователей (расширенная)
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            phone TEXT UNIQUE,
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

    // Таблица для кодов верификации
    db.run(`
        CREATE TABLE IF NOT EXISTS verifications (
            phone TEXT PRIMARY KEY,
            code TEXT,
            expires_at INTEGER
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
            created_at INTEGER,
            FOREIGN KEY (chat_id) REFERENCES chats(id),
            FOREIGN KEY (sender_id) REFERENCES users(id)
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

    // Создаём пользователя Матвей (только для групп)
    db.get('SELECT * FROM users WHERE id = ?', ['matvey'], (err, row) => {
        if (!row) {
            const hashedPass = bcrypt.hashSync('matvey123', 10);
            db.run(`
                INSERT INTO users (id, phone, username, password, name, avatar, bio, is_online, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'matvey',
                '+79999999999',
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
});

// ---------- API ЭНДПОИНТЫ ----------

// 1. Запрос кода верификации
app.post('/api/auth/request-code', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Телефон обязателен' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 минут

    db.run(
        'INSERT OR REPLACE INTO verifications (phone, code, expires_at) VALUES (?, ?, ?)',
        [phone, code, expiresAt],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            // В реальном проекте здесь отправка SMS
            console.log(`📱 Код для ${phone}: ${code}`);
            res.json({ success: true, message: 'Код отправлен', code }); // code только для dev
        }
    );
});

// 2. Подтверждение кода
app.post('/api/auth/verify-code', (req, res) => {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Телефон и код обязательны' });

    db.get('SELECT * FROM verifications WHERE phone = ?', [phone], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(400).json({ error: 'Код не найден' });
        if (Date.now() > row.expires_at) return res.status(400).json({ error: 'Код истёк' });
        if (row.code !== code) return res.status(400).json({ error: 'Неверный код' });

        // Проверяем, существует ли пользователь
        db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (user) {
                // Вход
                res.json({ success: true, action: 'login', userId: user.id });
            } else {
                // Регистрация
                res.json({ success: true, action: 'register', phone });
            }
        });
    });
});

// 3. Регистрация
app.post('/api/auth/register', async (req, res) => {
    const { phone, username, password, name } = req.body;
    if (!phone || !username || !password || !name) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const hashedPass = await bcrypt.hash(password, 10);
        const userId = uuidv4();

        db.run(
            `INSERT INTO users (id, phone, username, password, name, avatar, bio, is_online, created_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, phone, username, hashedPass, name, '👤', 'Новый пользователь', 1, Date.now(), Date.now()],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Телефон или логин уже заняты' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({ success: true, userId });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Логин по паролю
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    db.get('SELECT * FROM users WHERE username = ? OR phone = ?', [username, username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: 'Неверный пароль' });

        // Обновляем статус
        db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);
        res.json({ success: true, user: { id: user.id, name: user.name, username: user.username, phone: user.phone, avatar: user.avatar, bio: user.bio } });
    });
});

// 5. Поиск пользователей по телефону
app.get('/api/users/search/phone/:phone', (req, res) => {
    const { phone } = req.params;
    db.all('SELECT id, name, username, phone, avatar, bio, is_online FROM users WHERE phone LIKE ?', [`%${phone}%`], (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users.filter(u => u.id !== 'matvey'));
    });
});

// 6. Поиск пользователей по username
app.get('/api/users/search/username/:username', (req, res) => {
    const { username } = req.params;
    db.all('SELECT id, name, username, phone, avatar, bio, is_online FROM users WHERE username LIKE ?', [`%${username}%`], (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users.filter(u => u.id !== 'matvey'));
    });
});

// 7. Добавление в контакты
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

// 8. Получение контактов пользователя
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

// 9. Обновление профиля
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

// 10. Получение профиля пользователя
app.get('/api/users/:userId', (req, res) => {
    const { userId } = req.params;
    db.get('SELECT id, name, username, phone, avatar, bio, is_online, last_seen FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(user);
    });
});

// 11. Создание чата (личный или групповой)
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

            // Если это группа, добавляем Матвея автоматически
            if (isGroup && !members.includes('matvey')) {
                db.run('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)',
                    [chatId, 'matvey', 0, Date.now()]);
            }

            res.json({ success: true, chatId });
        }
    );
});

// 12. Получение чатов пользователя
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

// 13. Получение сообщений чата
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

// 14. Отправка сообщения (через Socket.IO)
// Socket.IO обрабатывает отправку сообщений в реальном времени

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

            // Получаем участников чата
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
    console.log(`📱 Код подтверждения для разработки выводится в консоль`);
});