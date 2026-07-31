// server.js — бэкенд UMAR с регистрацией, логином, Google OAuth и отправкой кода на email
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
const nodemailer = require('nodemailer');

// Google OAuth (для простоты используем passport)
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

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

// Настройка Passport для Google
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        done(err, user);
    });
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'demo_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'demo_secret',
    callbackURL: '/api/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
    const email = profile.emails[0].value;
    const name = profile.displayName || profile.name.givenName;

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) return done(err);
        if (user) return done(null, user);

        // Создаём нового пользователя
        const userId = uuidv4();
        db.run(`
            INSERT INTO users (id, email, name, username, avatar, is_online, created_at, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId,
            email,
            name,
            email.split('@')[0] + '_google',
            '👤',
            1,
            Date.now(),
            Date.now()
        ], (err) => {
            if (err) return done(err);
            db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
                done(err, user);
            });
        });
    });
}));

// ---------- НАСТРОЙКА EMAIL ----------
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || 'test@gmail.com',
        pass: process.env.SMTP_PASS || 'test_pass'
    }
});

// ---------- БАЗА ДАННЫХ ----------
const db = new sqlite3.Database('./umar.db');

db.serialize(() => {
    // Таблица пользователей (расширенная)
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            phone TEXT UNIQUE,
            email TEXT UNIQUE,
            username TEXT UNIQUE,
            password TEXT,
            name TEXT,
            avatar TEXT,
            bio TEXT,
            last_seen INTEGER,
            is_online INTEGER DEFAULT 0,
            created_at INTEGER,
            google_id TEXT
        )
    `);

    // Таблица для кодов верификации (телефон и email)
    db.run(`
        CREATE TABLE IF NOT EXISTS verifications (
            contact TEXT PRIMARY KEY,
            code TEXT,
            expires_at INTEGER,
            type TEXT DEFAULT 'phone'
        )
    `);

    // Остальные таблицы (чаты, сообщения, контакты)...
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

    db.run(`
        CREATE TABLE IF NOT EXISTS chat_members (
            chat_id TEXT,
            user_id TEXT,
            is_admin INTEGER DEFAULT 0,
            joined_at INTEGER,
            PRIMARY KEY (chat_id, user_id)
        )
    `);

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

// 1. Запрос кода (телефон или email)
app.post('/api/auth/request-code', (req, res) => {
    const { contact, type = 'phone' } = req.body;
    if (!contact) return res.status(400).json({ error: 'Контакт обязателен' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // Сохраняем код
    db.run(
        'INSERT OR REPLACE INTO verifications (contact, code, expires_at, type) VALUES (?, ?, ?, ?)',
        [contact, code, expiresAt, type],
        async (err) => {
            if (err) return res.status(500).json({ error: err.message });

            let sent = false;
            let message = 'Код отправлен';

            // Отправляем код в зависимости от типа
            if (type === 'email') {
                try {
                    await transporter.sendMail({
                        from: process.env.SMTP_USER || 'umar@messenger.com',
                        to: contact,
                        subject: 'Код подтверждения UMAR',
                        text: `Ваш код подтверждения: ${code}\nКод действителен 5 минут.`,
                        html: `<h2>Код подтверждения UMAR</h2><p>Ваш код: <b style="font-size:24px;">${code}</b></p><p>Код действителен 5 минут.</p>`
                    });
                    sent = true;
                    message = 'Код отправлен на почту';
                } catch (emailErr) {
                    console.error('Email error:', emailErr);
                    // Если email не настроен, показываем код в ответе
                    sent = false;
                }
            }

            // Для телефона или если email не работает — показываем код в ответе (dev режим)
            console.log(`📱 Код для ${contact}: ${code}`);

            // В dev режиме всегда возвращаем код (для демонстрации)
            res.json({
                success: true,
                message: message,
                code: code, // В продакшене убрать!
                devMode: true
            });
        }
    );
});

// 2. Подтверждение кода
app.post('/api/auth/verify-code', (req, res) => {
    const { contact, code } = req.body;
    if (!contact || !code) return res.status(400).json({ error: 'Контакт и код обязательны' });

    db.get('SELECT * FROM verifications WHERE contact = ?', [contact], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(400).json({ error: 'Код не найден' });
        if (Date.now() > row.expires_at) return res.status(400).json({ error: 'Код истёк' });
        if (row.code !== code) return res.status(400).json({ error: 'Неверный код' });

        // Удаляем использованный код
        db.run('DELETE FROM verifications WHERE contact = ?', [contact]);

        // Проверяем, существует ли пользователь
        const field = row.type === 'email' ? 'email' : 'phone';
        db.get(`SELECT * FROM users WHERE ${field} = ?`, [contact], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (user) {
                res.json({ success: true, action: 'login', userId: user.id });
            } else {
                res.json({ success: true, action: 'register', contact, type: row.type });
            }
        });
    });
});

// 3. Регистрация
app.post('/api/auth/register', async (req, res) => {
    const { contact, username, password, name, type = 'phone' } = req.body;
    if (!contact || !username || !password || !name) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const hashedPass = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        const field = type === 'email' ? 'email' : 'phone';

        db.run(
            `INSERT INTO users (id, ${field}, username, password, name, avatar, bio, is_online, created_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, contact, username, hashedPass, name, '👤', 'Новый пользователь', 1, Date.now(), Date.now()],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Контакт или логин уже заняты' });
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

    db.get('SELECT * FROM users WHERE username = ? OR phone = ? OR email = ?', 
        [username, username, username], 
        async (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
            if (!user.password) {
                return res.status(400).json({ error: 'Используйте вход через Google' });
            }

            const valid = await bcrypt.compare(password, user.password);
            if (!valid) return res.status(400).json({ error: 'Неверный пароль' });

            db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);
            res.json({ success: true, user: { id: user.id, name: user.name, username: user.username, phone: user.phone, email: user.email, avatar: user.avatar, bio: user.bio } });
        }
    );
});

// 5. Google OAuth маршруты
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/api/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/auth-fail' }),
    (req, res) => {
        // Редирект на фронтенд с токеном
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}?auth=google&userId=${req.user.id}`);
    }
);

// 6. Проверка Google авторизации
app.get('/api/auth/google/check', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ authenticated: true, user: req.user });
    } else {
        res.json({ authenticated: false });
    }
});

// Остальные эндпоинты (поиск, контакты, чаты, сообщения) остаются без изменений
// ... (код из предыдущей версии)

// ---------- ЗАПУСК ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 UMAR сервер запущен на порту ${PORT}`);
    console.log(`📱 Код подтверждения выводится в консоль и (если настроен email) отправляется на почту`);
});
