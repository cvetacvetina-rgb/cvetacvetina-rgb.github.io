// script.js — логика с простой регистрацией (только логин + пароль)
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

    // ========== ВАШ БЭКЕНД ==========
    const API_URL = 'https://cvetacvetina-rgb-github-io.onrender.com';

    // ---------- ПЕРЕКЛЮЧЕНИЕ ШАГОВ ----------
    function showStep(step) {
        [registerStep, loginStep].forEach(el => el.style.display = 'none');
        if (step) step.style.display = 'block';
        authError.style.display = 'none';
    }

    // ---------- РЕГИСТРАЦИЯ ----------
    document.getElementById('authRegisterBtn').addEventListener('click', async () => {
        const username = document.getElementById('regUsername').value.trim();
        const name = document.getElementById('regName').value.trim() || username;
        const password = document.getElementById('regPassword').value.trim();

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

        try {
            const res = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, name, password })
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

    // ---------- ВХОД ----------
    document.getElementById('authLoginBtn').addEventListener('click', async () => {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!username || !password) {
            showError('Заполните все поля');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
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
                avatar: c.avatar || '👤',
                color: c.color || '#2a2a2a',
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
        const query = prompt('🔍 Введите имя или логин для поиска:');
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
                    msg += `${i+1}. ${u.name} (@${u.username}) ${u.is_online ? '🟢' : '⚫'}\n`;
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

            // Активационный текст на новой строке
            if (!msg.voice && !msg.file && msg.text && !msg.text.includes('Активация UMAR')) {
                content += `<span class="activation-line">Активация UMAR: Чтобы активировать UMAR, заплатити 50 халяли</span>`;
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
        chat.unread = 0;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
        renderChatList();
        renderMessages(chatId);
    }

    // ---------- ОТПРАВКА СООБЩЕНИЯ ----------
    function sendMessage(text, file = null, voiceBlob = null) {
        if (!activeChatId) return;
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        let finalText = text || '';
        if (finalText.trim() === '' && !file && !voiceBlob) return;

        const now = new Date();
        const timeStr = now.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        let msgObj = { id: Date.now().toString(), time: timeStr, type: 'sent', senderId: currentUser.id };

        if (voiceBlob) {
            const url = URL.createObjectURL(voiceBlob);
            msgObj.voice = url;
            msgObj.text = '🎤 Голосовое сообщение';
        } else if (file) {
            msgObj.text = `📎 ${file}`;
            msgObj.file = file;
        } else {
            if (!finalText.includes('Активация UMAR')) {
                finalText = finalText + '\nАктивация UMAR: Чтобы активировать UMAR, заплатити 50 халяли';
            }
            msgObj.text = finalText;
        }

        chat.messages.push(msgObj);
        renderMessages(activeChatId);
        renderChatList();

        // Отправка на сервер через Socket.IO
        socket.emit('send_message', {
            chatId: chat.id,
            senderId: currentUser.id,
            text: msgObj.text,
            file: file,
            voice: voiceBlob ? 'voice' : null
        });

        // Автоответ Матвея (только в группах)
        if (chat.isGroup && chat.members.includes('matvey')) {
            setTimeout(() => {
                const spam = [
                    '777 СТАВОК КАЗИНО! ПЫЧОК МАТВЕЙ ОТКРЫЛ НОВОЕ КАЗИНО! ПЫК!',
                    'БАЙТЕРАМ ВСЕМ ПРИВЕТ! 18+ ТОЛЬКО У НАС! ССЫЛКА В ОПИСАНИИ!',
                    'МАТВЕЙ ЗОВЁТ ТЕБЯ В НОВЫЙ КЛУБ! ПЫК ПЫК 777!',
                    'ВСЕ НА КАЗИНО МАТВЕЯ! БОНУС 777% НА ПЕРВЫЙ ДЕПОЗИТ!'
                ];
                const reply = spam[Math.floor(Math.random() * spam.length)];
                const replyTime = new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                chat.messages.push({
                    id: Date.now().toString() + 'm',
                    text: reply,
                    time: replyTime,
                    type: 'received',
                    senderId: 'matvey'
                });
                renderMessages(activeChatId);
                renderChatList();
            }, 2000 + Math.random() * 3000);
        }
    }

    // ---------- ОБРАБОТЧИКИ ----------
    const chatListEl = document.getElementById('chatList');
    const messagesArea = document.getElementById('messagesArea');
    const headerName = document.getElementById('headerName');
    const headerStatus = document.getElementById('headerStatus');
    const headerAvatar = document.getElementById('headerAvatar');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const searchInput = document.getElementById('searchInput');
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    const themeSwitch = document.getElementById('themeSwitch');
    const attachBtn = document.getElementById('attachBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const createGroupBtn = document.getElementById('createGroupBtn');
    const groupModal = document.getElementById('groupModal');
    const closeGroupModal = document.getElementById('closeGroupModal');
    const groupNameInput = document.getElementById('groupNameInput');
    const groupMembersList = document.getElementById('groupMembersList');
    const createGroupConfirm = document.getElementById('createGroupConfirm');
    const groupSettingsBtn = document.getElementById('groupSettingsBtn');

    // Отправка сообщения
    sendBtn.addEventListener('click', () => {
        const text = messageInput.value.trim();
        if (text) {
            sendMessage(text);
            messageInput.value = '';
        }
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    // Поиск
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderChatList();
    });

    // Настройки
    settingsToggle.addEventListener('click', () => settingsModal.classList.add('active'));
    closeSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.classList.remove('active');
    });

    // Тема
    themeSwitch.addEventListener('change', function() {
        if (!this.checked) {
            alert('Ты что, расист?');
            this.checked = true;
            return;
        }
        document.body.classList.remove('light-theme');
    });

    // Файлы
    attachBtn.addEventListener('click', () => {
        if (!activeChatId) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,audio/*,video/*,.pdf,.doc,.docx,.txt';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) sendMessage('', file.name, null);
        };
        input.click();
    });

    // Голос
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];

    voiceBtn.addEventListener('click', async () => {
        if (!activeChatId) {
            alert('Сначала выберите чат');
            return;
        }
        if (isRecording) {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            isRecording = false;
            voiceBtn.classList.remove('recording');
            voiceBtn.textContent = '🎤';
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                if (audioBlob.size > 0) sendMessage('', null, audioBlob);
                stream.getTracks().forEach(track => track.stop());
                isRecording = false;
                voiceBtn.classList.remove('recording');
                voiceBtn.textContent = '🎤';
            };

            mediaRecorder.start();
            isRecording = true;
            voiceBtn.classList.add('recording');
            voiceBtn.textContent = '⏹️';
        } catch (err) {
            alert('Не удалось получить доступ к микрофону: ' + err.message);
        }
    });

    // Создание группы
    createGroupBtn.addEventListener('click', async () => {
        groupModal.classList.add('active');
        const res = await fetch(`${API_URL}/api/users`);
        const users = await res.json();
        groupMembersList.innerHTML = '';
        users.forEach(u => {
            if (u.id !== currentUser.id && u.id !== 'matvey') {
                const div = document.createElement('div');
                div.className = 'member-checkbox';
                div.innerHTML = `
                    <input type="checkbox" value="${u.id}">
                    <span>${u.name} (@${u.username})</span>
                `;
                groupMembersList.appendChild(div);
            }
        });
        // Матвей всегда добавлен
        const div = document.createElement('div');
        div.className = 'member-checkbox';
        div.innerHTML = `
            <input type="checkbox" checked disabled>
            <span>Матвей (обязательный)</span>
        `;
        groupMembersList.appendChild(div);
        groupNameInput.value = '';
    });

    closeGroupModal.addEventListener('click', () => groupModal.classList.remove('active'));
    groupModal.addEventListener('click', (e) => {
        if (e.target === groupModal) groupModal.classList.remove('active');
    });

    createGroupConfirm.addEventListener('click', async () => {
        const name = groupNameInput.value.trim() || 'Новая группа';
        const checkboxes = groupMembersList.querySelectorAll('input[type="checkbox"]:checked');
        const members = [currentUser.id];
        checkboxes.forEach(cb => {
            if (cb.value) members.push(cb.value);
        });
        if (!members.includes('matvey')) members.push('matvey');

        if (members.length < 3) {
            alert('В группе должно быть минимум 3 участника (включая вас и Матвея)');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/chats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    isGroup: true,
                    members: members,
                    creatorId: currentUser.id
                })
            });
            const data = await res.json();
            if (data.success) {
                groupModal.classList.remove('active');
                await loadChats();
                renderChatList();
                const newChat = chats.find(c => c.id === data.chatId);
                if (newChat) openChat(newChat.id);
            }
        } catch (err) {
            alert('Ошибка создания группы: ' + err.message);
        }
    });

    // ---------- ОТКРЫТЬ ПЕРВЫЙ ЧАТ ----------
    function openDefaultChat() {
        if (chats.length > 0) {
            openChat(chats[0].id);
        }
    }

    // ---------- ЗАПУСК ----------
    showStep(registerStep);
    console.log('📱 UMAR готов к работе');
    console.log('🔗 Бэкенд:', API_URL);
})();
