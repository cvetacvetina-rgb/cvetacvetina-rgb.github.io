// storage.js — работа с базой данных
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const db = new sqlite3.Database('./umar.db');

// Инициализация таблиц
function initDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                name TEXT,
                avatar TEXT,
                bio TEXT,
                last_seen INTEGER,
                is_online INTEGER DEFAULT 0,
                created_at INTEGER
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                name TEXT,
                is_group INTEGER DEFAULT 0,
                avatar TEXT,
                color TEXT,
                description TEXT,
                created_at INTEGER
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS chat_members (
                chat_id TEXT,
                user_id TEXT,
                is_admin INTEGER DEFAULT 0,
                joined_at INTEGER,
                PRIMARY KEY (chat_id, user_id)
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT,
                sender_id TEXT,
                text TEXT,
                file TEXT,
                voice TEXT,
                reply_to TEXT,
                is_edited INTEGER DEFAULT 0,
                created_at INTEGER
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS contacts (
                user_id TEXT,
                contact_id TEXT,
                created_at INTEGER,
                PRIMARY KEY (user_id, contact_id)
            )`);
            console.log('✅ Таблицы созданы');
            resolve();
        });
    });
}

// Регистрация
function createUser(username, password, name, avatarPath) {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err) return reject(err);
            const userId = String((row.count || 0) + 1).padStart(5, '0');

            bcrypt.hash(password, 10, (err, hashedPass) => {
                if (err) return reject(err);
                const now = Date.now();

                db.run(
                    `INSERT INTO users (id, username, password, name, avatar, bio, is_online, created_at, last_seen)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, username, hashedPass, name || username, avatarPath, 'Новый пользователь', 1, now, now],
                    function(err) {
                        if (err) return reject(err);
                        resolve({
                            id: userId,
                            username: username,
                            name: name || username,
                            avatar: avatarPath,
                            bio: 'Новый пользователь',
                            is_online: 1
                        });
                    }
                );
            });
        });
    });
}

// Логин
function loginUser(username, password) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
            if (err) return reject(err);
            if (!user) return reject(new Error('Пользователь не найден'));

            bcrypt.compare(password, user.password, (err, valid) => {
                if (err) return reject(err);
                if (!valid) return reject(new Error('Неверный пароль'));

                db.run('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?', [Date.now(), user.id]);
                resolve({
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    avatar: user.avatar,
                    bio: user.bio,
                    is_online: 1
                });
            });
        });
    });
}

// Получить всех пользователей
function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, username, name, avatar, bio, is_online FROM users WHERE id != ?', ['matvey'], (err, users) => {
            if (err) return reject(err);
            resolve(users);
        });
    });
}

// Поиск пользователей
function searchUsers(query) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT id, username, name, avatar, bio, is_online FROM users WHERE (username LIKE ? OR name LIKE ?) AND id != ?',
            [`%${query}%`, `%${query}%`, 'matvey'],
            (err, users) => {
                if (err) return reject(err);
                resolve(users);
            }
        );
    });
}

// Получить пользователя по ID
function getUserById(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, username, name, avatar, bio, is_online, last_seen FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) return reject(err);
            resolve(user);
        });
    });
}

// Обновить статус
function updateUserStatus(userId, isOnline) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET is_online = ?, last_seen = ? WHERE id = ?', [isOnline ? 1 : 0, Date.now(), userId], (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

// КОНТАКТЫ
function addContact(userId, contactId) {
    return new Promise((resolve, reject) => {
        db.run('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)',
            [userId, contactId, Date.now()],
            function(err) {
                if (err) return reject(err);
                resolve({ success: true });
            }
        );
    });
}

function getContacts(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT u.id, u.username, u.name, u.avatar, u.bio, u.is_online
            FROM users u
            JOIN contacts c ON c.contact_id = u.id
            WHERE c.user_id = ?
        `, [userId], (err, contacts) => {
            if (err) return reject(err);
            resolve(contacts);
        });
    });
}

// ЧАТЫ
function createChat(name, isGroup, members, creatorId, description = '') {
    return new Promise((resolve, reject) => {
        const chatId = uuidv4();
        const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

        db.run(
            `INSERT INTO chats (id, name, is_group, avatar, color, description, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [chatId, name || (isGroup ? 'Группа' : members[0]), isGroup ? 1 : 0, isGroup ? '👥' : '👤', color, description || '', Date.now()],
            function(err) {
                if (err) return reject(err);

                const stmt = db.prepare('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)');
                members.forEach(m => {
                    stmt.run(chatId, m, m === creatorId ? 1 : 0, Date.now());
                });
                stmt.finalize();

                if (isGroup && !members.includes('matvey')) {
                    db.run('INSERT INTO chat_members (chat_id, user_id, is_admin, joined_at) VALUES (?, ?, ?, ?)',
                        [chatId, 'matvey', 0, Date.now()]);
                }

                resolve({ chatId });
            }
        );
    });
}

function getUserChats(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count,
                   (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id) as members,
                   (SELECT json_group_array(user_id) FROM chat_members WHERE chat_id = c.id AND is_admin = 1) as admins
            FROM chats c
            JOIN chat_members cm ON cm.chat_id = c.id
            WHERE cm.user_id = ?
        `, [userId], (err, chats) => {
            if (err) return reject(err);
            resolve(chats);
        });
    });
}

// СООБЩЕНИЯ
function saveMessage(chatId, senderId, text, file = null, voice = null, replyTo = null) {
    return new Promise((resolve, reject) => {
        const msgId = uuidv4();
        const now = Date.now();

        db.run(
            `INSERT INTO messages (id, chat_id, sender_id, text, file, voice, reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [msgId, chatId, senderId, text || '', file, voice, replyTo, now],
            function(err) {
                if (err) return reject(err);
                resolve({
                    id: msgId,
                    chatId: chatId,
                    senderId: senderId,
                    text: text || '',
                    file: file,
                    voice: voice,
                    replyTo: replyTo,
                    created_at: now
                });
            }
        );
    });
}

function getMessages(chatId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
            FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id
            WHERE m.chat_id = ?
            ORDER BY m.created_at ASC
            LIMIT 100
        `, [chatId], (err, messages) => {
            if (err) return reject(err);
            resolve(messages);
        });
    });
}

function getChatMembers(chatId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId], (err, members) => {
            if (err) return reject(err);
            resolve(members.map(m => m.user_id));
        });
    });
}

// МАТВЕЙ
function ensureMatvey() {
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
                    resolve({ id: 'matvey', username: 'matvey', name: 'Матвей' });
                }
            );
        });
    });
}

module.exports = {
    initDatabase,
    createUser,
    loginUser,
    getAllUsers,
    searchUsers,
    getUserById,
    updateUserStatus,
    addContact,
    getContacts,
    createChat,
    getUserChats,
    saveMessage,
    getMessages,
    getChatMembers,
    ensureMatvey
};
