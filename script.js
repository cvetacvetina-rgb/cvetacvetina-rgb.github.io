// script.js — логика UMAR с активационным текстом на новой строке для всех
(function() {
    'use strict';

    let currentUser = null;
    let socket = null;
    let chats = [];
    let activeChatId = null;
    let searchQuery = '';
    let allUsers = [];

    // DOM
    const authModal = document.getElementById('authModal');
    const appContainer = document.getElementById('appContainer');
    const authError = document.getElementById('authError');

    const registerStep = document.getElementById('authRegisterStep');
    const loginStep = document.getElementById('authLoginStep');

    // ========== БЭКЕНД ==========
    const API_URL = 'https://cvetavetina-rgb.github.io.onrender.com';

    // ---------- ПЕРЕКЛЮЧЕНИЕ ШАГОВ ----------
    function showStep(step) {
        [registerStep, loginStep].forEach(el => el.style.display = 'none');
        if (step) step.style.display = 'block';
        authError.style.display = 'none';
    }

    // ---------- РЕГИСТРАЦИЯ (телефон + username + пароль + аватар) ----------
    document.getElementById('authRegisterBtn').addEventListener('click', async () => {
        const phone = document.getElementById('regPhone').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        const name = document.getElementById('regName').value.trim() || username;
        const password = document.getElementById('regPassword').value.trim();
        const avatarFile = document.getElementById('regAvatar').files[0];

        if (!phone) {
            showError('Введите телефон');
            return;
        }
        if (!phone.match(/^\+?[0-9]{10,15}$/)) {
            showError('Неверный формат телефона (пример: +79991234567)');
            return;
        }
        if (!username) {
            showError('Введите логин');
            return;
        }
        if (username.length < 3) {
            showError('Логин должен быть минимум 3 символа');
            return;
        }
        if (!password) {
            showError('Введите пароль');
            return;
        }
        if (password.length < 6) {
            showError('Пароль должен быть минимум 6 символов');
            return;
        }
        if (!avatarFile) {
            showError('Загрузите аватар');
            return;
        }

        try {
            const formData = new FormData();
            formData.append('phone', phone);
            formData.append('username', username);
            formData.append('name', name);
            formData.append('password', password);
            formData.append('avatar', avatarFile);

            const res = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                currentUser = data.user;
                authModal.classList.remove('active');
                authModal.style.display = 'none';
                appContainer.style.display = 'flex';
                initApp();
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    });

    // ---------- ВХОД (по телефону или username) ----------
    document.getElementById('authLoginBtn').addEventListener('click', async () => {
        const login = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!login || !password) {
            showError('Заполните все поля');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login, password })
            });
            const data = await res.json();
            if (data.success) {
                currentUser = data.user;
                authModal.classList.remove('active');
                authModal.style.display = 'none';
                appContainer.style.display = 'flex';
                initApp();
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    });

    // Enter для отправки форм
    document.getElementById('regPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('authRegisterBtn').click();
    });
    document.getElementById('loginPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('authLoginBtn').click();
    });

    // Переключение между регистрацией и входом
    document.getElementById('switchToLogin').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(loginStep);
    });
    document.getElementById('switchToRegister').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(registerStep);
    });

    function showError(msg) {
        authError.textContent = msg;
        authError.style.display = 'block';
    }

    // ---------- ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ----------
    async function initApp() {
        socket = io(API_URL, { query: { userId: currentUser.id } });
        await loadChats();
        await loadContacts();
        setupSocket();
        renderChatList();
        openDefaultChat();
        document.getElementById('findPeopleBtn').addEventListener('click', openFindPeople);
    }

    function setupSocket() {
        socket.on('new_message', (data) => {
            const chat = chats.find(c => c.id === data.chatId);
            if (chat) {
                chat.messages.push(data);
                if (activeChatId === chat.id) renderMessages(activeChatId);
                renderChatList();
            }
        });

        socket.on('user_status', ({ userId, status }) => {
            const chat = chats.find(c => c.id === userId);
            if (chat) {
                chat.status = status;
                renderChatList();
                if (activeChatId === userId) renderMessages(userId);
            }
        });
    }

    // ---------- ЗАГРУЗКА ЧАТОВ ----------
    async function loadChats() {
        try {
            const res = await fetch(`${API_URL}/api/chats/${currentUser.id}`);
            const data = await res.json();
            chats = data.map(c => ({
                id: c.id,
                name: c.name,
                isGroup: c.is_group === 1,
                members: JSON.parse(c.members || '[]'),
                admins: JSON.parse(c.admins || '[]'),
                avatar: c.avatar || '👤',
                color: c.color || '#2a2a2a',
                description: c.description || '',
                status: 'online',
                messages: [],
                unread: 0
            }));

            for (const chat of chats) {
                const msgsRes = await fetch(`${API_URL}/api/messages/${chat.id}`);
                const msgs = await msgsRes.json();
                chat.messages = msgs.map(m => ({
                    id: m.id,
                    text: m.text,
                    time: new Date(m.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    type: m.sender_id === currentUser.id ? 'sent' : 'received',
                    senderId: m.sender_id,
                    file: m.file,
                    voice: m.voice,
                    replyTo: m.reply_to,
                    edited: m.is_edited === 1
                }));
            }
        } catch (err) {
            console.error('Ошибка загрузки чатов:', err);
        }
    }

    async function loadContacts() {
        try {
            const res = await fetch(`${API_URL}/api/contacts/${currentUser.id}`);
            allUsers = await res.json();
        } catch (err) {
            console.error('Ошибка загрузки контактов:', err);
        }
    }

    // ---------- ПОИСК ЛЮДЕЙ ----------
    function openFindPeople() {
        const query = prompt('🔍 Введите имя, телефон или логин для поиска:');
        if (!query) return;

        fetch(`${API_URL}/api/users/search/${encodeURIComponent(query)}`)
            .then(res => res.json())
            .then(users => {
                if (users.length === 0) {
                    alert('Пользователи не найдены');
                    return;
                }
                let msg = 'Найдены пользователи:\n\n';
                users.forEach((u, i) => {
                    msg += `${i+1}. ${u.name} (@${u.username}) ${u.phone} ${u.is_online ? '🟢' : '⚫'}\n`;
                });
                const choice = prompt(msg + '\nВведите номер для добавления в контакты (или отмена):');
                if (choice) {
                    const idx = parseInt(choice) - 1;
                    if (idx >= 0 && idx < users.length) {
                        const user = users[idx];
                        fetch(`${API_URL}/api/contacts`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: currentUser.id, contactId: user.id })
                        }).then(() => {
                            alert(`@${user.username} добавлен в контакты`);
                            loadContacts();
                        });
                    }
                }
            })
            .catch(err => alert('Ошибка поиска: ' + err.message));
    }

    // ---------- ОТРИСОВКА СПИСКА ЧАТОВ ----------
    function renderChatList() {
        const query = searchQuery.toLowerCase().trim();
        let filtered = chats;
        if (query) {
            filtered = chats.filter(c => c.name.toLowerCase().includes(query));
        }

        chatListEl.innerHTML = '';
        filtered.forEach(chat => {
            const lastMsg = chat.messages.length > 0 ? chat.messages[chat.messages.length-1] : null;
            let lastText = lastMsg ? lastMsg.text : 'Нет сообщений';
            if (lastMsg && lastMsg.senderId === 'matvey') {
                lastText = 'Матвей: ' + lastText.split('\n')[0];
            }
            const lastTime = lastMsg ? lastMsg.time : '';
            const unread = chat.unread || 0;

            const div = document.createElement('div');
            div.className = `chat-item ${activeChatId === chat.id ? 'active' : ''}`;
            div.dataset.id = chat.id;

            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar';
            avatarDiv.style.background = chat.color || '#2a2a2a';
            avatarDiv.textContent = chat.isGroup ? '👥' : (chat.avatar || chat.name.charAt(0).toUpperCase());
            if (!chat.isGroup) {
                const dot = document.createElement('span');
                dot.className = `status-dot ${chat.status === 'online' ? 'online' : 'offline'}`;
                avatarDiv.appendChild(dot);
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'chat-info';
            const nameSpan = document.createElement('div');
            nameSpan.className = 'chat-name';
            const statusText = chat.isGroup ? `👥 ${chat.members.length} уч.` : (chat.status === 'online' ? '🟢 онлайн' : '⚫ офлайн');
            nameSpan.innerHTML = `${chat.isGroup ? '👥 ' : ''}${chat.name} <span class="status-text ${chat.status === 'online' ? 'online' : ''}">${statusText}</span>`;
            const preview = document.createElement('div');
            preview.className = 'last-preview';
            preview.innerHTML = `${lastText} <span class="time">${lastTime}</span>`;
            if (unread > 0) {
                const badge = document.createElement('span');
                badge.className = 'unread-badge';
                badge.textContent = unread;
                preview.appendChild(badge);
            }
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(preview);

            div.appendChild(avatarDiv);
            div.appendChild(infoDiv);
            chatListEl.appendChild(div);

            div.addEventListener('click', () => openChat(chat.id));
        });
    }

    // ---------- ОТРИСОВКА СООБЩЕНИЙ ----------
    function renderMessages(chatId) {
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        messagesArea.innerHTML = '';

        chat.messages.forEach(msg => {
            const bubble = document.createElement('div');
            const isSent = msg.type === 'sent';
            bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
            bubble.dataset.messageId = msg.id;

            let senderName = '';
            if (chat.isGroup && msg.senderId && msg.senderId !== 'system' && msg.senderId !== 'matvey') {
                const sender = allUsers.find(u => u.id === msg.senderId);
                senderName = (sender ? sender.name : msg.senderId) + ': ';
            }
            if (msg.senderId === 'matvey') {
                senderName = 'Матвей: ';
            }

            let content = senderName + msg.text;
            if (msg.file) {
                content += `<div class="file-attach">📎 ${msg.file}</div>`;
            }
            if (msg.voice) {
                content += `<div class="voice-player"><audio controls src="${msg.voice}"></audio></div>`;
            }

            // ===== АКТИВАЦИОННЫЙ ТЕКСТ НА НОВОЙ СТРОКЕ ДЛЯ ВСЕХ =====
            // Для голосовых — НЕ добавляем
            if (!msg.voice) {
                // Для текстовых — новая строка
                if (!msg.file) {
                    if (!msg.text.includes('Активация UMAR')) {
                        content += `<span class="activation-line">Активация UMAR: Чтобы активировать UMAR, заплатити 50 халяли</span>`;
                    }
                } else {
                    // Для файлов — сбоку (уже в file-attach, но добавим для надёжности)
                    if (!content.includes('Активация UMAR')) {
                        content += `<span class="activation-line">Активация UMAR: Чтобы активировать UMAR, заплатити 50 халяли</span>`;
                    }
                }
            }

            content += ` <span class="time">${msg.time}</span>`;
            bubble.innerHTML = content;
            messagesArea.appendChild(bubble);
        });
        messagesArea.scrollTop = messagesArea.scrollHeight;

        // Обновляем хедер
        headerName.textContent = chat.name;
        if (chat.isGroup) {
            headerStatus.textContent = `👥 ${chat.members.length} участников`;
            headerStatus.className = '';
            headerAvatar.textContent = '👥';
            headerAvatar.style.background = chat.color || '#6c5ce7';
            groupSettingsBtn.style.display = 'flex';
        } else {
            const isOnline = chat.status === 'online';
            headerStatus.textContent = isOnline ? '🟢 онлайн' : '⚫ офлайн';
            headerStatus.className = isOnline ? 'online' : '';
            headerAvatar.textContent = chat.avatar || chat.name.charAt(0).toUpperCase();
            headerAvatar.style.background = chat.color || '#2a2a2a';
            groupSettingsBtn.style.display = 'none';
        }
    }

    // ---------- ОТКРЫТЬ ЧАТ ----------
    function openChat(chatId) {
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        activeChatId = chatId;
       
