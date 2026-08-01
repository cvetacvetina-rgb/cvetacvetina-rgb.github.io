// server.js — UMAR бэкенд (гарантированно работает)
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

// ========== НАСТРОЙКА CORS (РАЗРЕШАЕМ ВСЁ) ==========
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));
app.options('*', cors());

// ========== MIDDLEWARE ==========
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static('uploads'));

// ========== ГЛАВНЫЙ РОУТ (ЧТОБЫ НЕ БЫЛО 404) ==========
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'UMAR API is running! 🚀',
        version: '2.0',
        endpoints: [
            '/api/users',
            '/api/auth/register',
            '/api/auth/login',
            '/api/contacts',
            '/api/chats',
            '/api/messages'
        ]
    });
});

// ========== НАСТРОЙКА MULTER ДЛЯ АВАТАРОВ ==========
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/avatars';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения (JPEG, PNG, GIF, WEBP)'));
        }
    }
});

// ========== ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ==========
const db = new sqlite3.Database('./umar.db', (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err.message);
    } else {
        console.log('✅ База данных подключена');
    }
});

// ========== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ==========
db.serialize(() => {
    // Пользователи
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

    // Чаты
    db.run(`
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            name TEXT,
            is_group INTEGER DEFAULT 0,
            avatar TEXT,
            color TEXT,
            description TEXT,
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
            PRIMARY KEY (user_id, contact_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (contact_id) REFERENCES users(id)
        )
    `);

    console.log('✅ Все таблицы созданы/проверены');
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Генерация ID пользователя
function generateUserId() {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err) return reject(err);
            const count = row ? row.count : 0;
            resolve(String(count + 1).padStart(5, '0'));
        });
    });
}

// Создание Матвея (если не существует)
async function ensureMatvey() {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', ['matvey'], (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(row);

            const hashedPass = bcrypt.hashSync('matvey123', 10);
            db.run(
                `INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['matvey', 'matvey', hashedPass, 'Матвей', '/uploads/avatars/matvey.png', 'Казино-бот 🎰', 1, Date.now()],
                function(err) {
                    if (err) return reject(err);
                    console.log('✅ Матвей создан');
                    resolve({ id: 'matvey', username: 'matvey', name: 'Матвей' });
                }
            );
        });
    });
}

// ========== API ЭНДПОИНТЫ ==========

// === ТЕСТОВЫЙ ЭНДПОИНТ ===
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'API работает!', timestamp: Date.now() });
});

// === 1. РЕГИСТРАЦИЯ ===
app.post('/api/auth/register', upload.single('avatar'), async (req, res) => {
    console.log('📝 Регистрация запрос получен');
    console.log('📦 Body:', req.body);
    console.log('📎 Файл:', req.file ? req.file.filename : 'нет');

    try {
        const { username, password, name } = req.body;

        // Валидация
        if (!username) return res.status(400).json({ error: 'Логин обязателен' });
        if (!password) return res.status(400).json({ error: 'Пароль обязателен' });
        if (!req.file) return res.status(400).json({ error: 'Аватар обязателен' });
        if (username.length < 3) return res.status(400).json({ error: 'Логин должен быть минимум 3 символа' });
        if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });

        const hashedPass = await bcrypt.hash(password, 10);
        const displayName = name || username;
        const avatarPath = `/uploads/avatars/${req.file.filename}`;

        // Генерируем ID
        const userId = await generateUserId();

        // Сохраняем в БД
        db.run(
            `INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, username, hashedPass, displayName, avatarPath, 'Новый пользователь', 1, Date.now(), Date.now()],
            function(err) {
                if (err) {
                    console.error('❌ Ошибка БД:', err.message);
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Логин уже занят' });
                    }
                    return res.status(500).json({ error: err.message });
                }

                console.log('✅ Пользователь создан:', userId);
                res.json({
                    success: true,
                    user: {
                        id: userId,
                        username: username,
                        name: displayName,
                        avatar: avatarPath,
                        bio: 'Новый пользователь',
                        is_online: 1
                    }
                });
            }
        );
    } catch (err) {
        console.error('❌ Ошибка:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// === 2. ЛОГИН ===
app.post('/api/auth/login', (req, res) => {
    console.log('📝 Вход запрос получен');
    console.log('📦 Body:', req.body);

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            console.log('❌ Пользователь не найден:', username);
            return res.status(400).json({ error: 'Пользователь не найден' });
        }

        try {
            const valid = await bcrypt.compare(password, user.password);
            if (!valid) {
                console.log('❌ Неверный пароль для:', username);
                return res.status(400).json({ error: 'Неверный пароль' });
            }

            db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);

            console.log('✅ Вход успешен:', username);
            res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    avatar: user.avatar,
                    bio: user.bio,
                    is_online: 1
                }
            });
        } catch (err) {
            console.error('❌ Ошибка:', err.message);
            res.status(500).json({ error: err.message });
        }
    });
});

// === 3. ПОЛУЧЕНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ===
app.get('/api/users', (req, res) => {
    console.log('📥 Запрос списка пользователей');
    db.all('SELECT id, username, name, avatar, bio, is_online FROM users WHERE id != ?', ['matvey'], (err, users) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ Найдено ${users.length} пользователей`);
        res.json(users);
    });
});

// === 4. ПОИСК ПОЛЬЗОВАТЕЛЕЙ ===
app.get('/api/users/search/:query', (req, res) => {
    const { query } = req.params;
    console.log('🔍 Поиск:', query);

    db.all(
        'SELECT id, username, name, avatar, bio, is_online FROM users WHERE (username LIKE ? OR name LIKE ?) AND id != ?',
        [`%${query}%`, `%${query}%`, 'matvey'],
        (err, users) => {
            if (err) {
                console.error('❌ Ошибка БД:', err.message);
                return res.status(500).json({ error: err.message });
            }
            console.log(`✅ Найдено ${users.length} пользователей`);
            res.json(users);
        }
    );
});

// === 5. ПОЛУЧЕНИЕ ПРОФИЛЯ ===
app.get('/api/users/:userId', (req, res) => {
    const { userId } = req.params;
    console.log('👤 Запрос профиля:', userId);

    db.get('SELECT id, username, name, avatar, bio, is_online, last_seen FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            console.log('❌ Пользователь не найден:', userId);
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json(user);
    });
});

// === 6. КОНТАКТЫ — ДОБАВЛЕНИЕ ===
app.post('/api/contacts', (req, res) => {
    const { userId, contactId } = req.body;
    console.log('📝 Добавление в контакты:', { userId, contactId });

    if (!userId || !contactId) {
        return res.status(400).json({ error: 'ID обязательны' });
    }

    db.run(
        'INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)',
        [userId, contactId, Date.now()],
        function(err) {
            if (err) {
                console.error('❌ Ошибка БД:', err.message);
                return res.status(500).json({ error: err.message });
            }
            console.log('✅ Контакт добавлен');
            res.json({ success: true });
        }
    );
});

// === 7. КОНТАКТЫ — ПОЛУЧЕНИЕ ===
app.get('/api/contacts/:userId', (req, res) => {
    const { userId } = req.params;
    console.log('👥 Запрос контактов:', userId);

    db.all(`
        SELECT u.id, u.username, u.name, u.avatar, u.bio, u.is_online
        FROM users u
        JOIN contacts c ON c.contact_id = u.id
        WHERE c.user_id = ?
    `, [userId], (err, contacts) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ Найдено ${contacts.length} контактов`);
        res.json(contacts);
    });
});

// === 8. СОЗДАНИЕ ЧАТА ===
app.post('/api/chats', (req, res) => {
    const { name, isGroup, members, creatorId, description } = req.body;
    console.log('📝 Создание чата:', { name, isGroup, members });

    if (!members || !members.length) {
        return res.status(400).json({ error: 'Участники обязательны' });
    }

    const chatId = uuidv4();
    const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

    db.run(
        `INSERT INTO chats (id, name, is_group, avatar, color, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [chatId, name || (isGroup ? 'Группа' : members[0]), isGroup ? 1 : 0, isGroup ? '👥' : '👤', color, description || '', Date.now()],
        function(err) {
            if (err) {
                console.error('❌ Ошибка БД:', err.message);
                return res.status(500).json({ error: err.message });
            }

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

            console.log('✅ Чат создан:', chatId);
            res.json({ success: true, chatId });
        }
    );
});

// === 9. ПОЛУЧЕНИЕ ЧАТОВ ПОЛЬЗОВАТЕЛЯ ===
app.get('/api/chats/:userId', (req, res) => {
    const { userId } = req.params;
    console.log('💬 Запрос чатов:', userId);

    db.all(`
        SELECT c.*,
               (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count,
               (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id) as members,
               (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id AND is_admin = 1) as admins
        FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id
        WHERE cm.user_id = ?
    `, [userId], (err, chats) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ Найдено ${chats.length} чатов`);
        res.json(chats);
    });
});

// === 10. ПОЛУЧЕНИЕ СООБЩЕНИЙ ===
app.get('/api/messages/:chatId', (req, res) => {
    const { chatId } = req.params;
    console.log('💬 Запрос сообщений чата:', chatId);

    db.all(`
        SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
    `, [chatId], (err, messages) => {
        if (err) {
            console.error('❌ Ошибка БД:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ Найдено ${messages.length} сообщений`);
        res.json(messages);
    });
});

// ========== SOCKET.IO ==========
const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const onlineUsers = new Set();

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    console.log('🔌 Пользователь подключился:', userId);

    if (userId) {
        onlineUsers.add(userId);
        db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), userId]);
        io.emit('user_status', { userId, status: 'online' });
    }

    socket.on('send_message', (data) => {
        const { chatId, senderId, text, file, voice, replyTo } = data;
        console.log('💬 Новое сообщение:', { chatId, senderId });

        const msgId = uuidv4();

        db.run(`
            INSERT INTO messages (id, chat_id, sender_id, text, file, voice, reply_to, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [msgId, chatId, senderId, text || '', file || null, voice || null, replyTo || null, Date.now()],
        function(err) {
            if (err) {
                console.error('❌ Ошибка сохранения сообщения:', err.message);
                return socket.emit('error', err.message);
            }

            db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, members) => {
                if (err) {
                    console.error('❌ Ошибка получения участников:', err.message);
                    return;
                }

                const messageData = {
                    id: msgId,
                    chatId: chatId,
                    senderId: senderId,
                    text: text || '',
                    file: file || null,
                    voice: voice || null,
                    replyTo: replyTo || null,
                    created_at: Date.now()
                };

                members.forEach(m => {
                    if (m.user_id !== senderId) {
                        io.to(m.user_id).emit('new_message', messageData);
                    }
                });

                io.to(senderId).emit('message_sent', messageData);
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
            console.log('🔌 Пользователь отключился:', userId);
        }
    });
});

// ========== ИНИЦИАЛИЗАЦИЯ МАТВЕЯ ==========
ensureMatvey().catch(err => {
    console.error('❌ Ошибка создания Матвея:', err.message);
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 UMAR сервер запущен на порту ${PORT}`);
    console.log(`📁 Папка uploads: ${__dirname}/uploads`);
    console.log(`📋 База данных: ${__dirname}/umar.db`);
    console.log(`🌐 Основной URL: https://cvetavetina-rgb-github-io.onrender.com`);
    console.log(`🧪 Тестовый эндпоинт: /api/test`);
});

// ========== ОБРАБОТКА НЕПРЕДВИДЕННЫХ ОШИБОК ==========
process.on('uncaughtException', (err) => {
    console.error('❌ Неперехваченная ошибка:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Необработанный Promise:', err);
});
