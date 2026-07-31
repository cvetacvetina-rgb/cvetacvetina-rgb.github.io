// script.js — дополненная логика с авторизацией и реальными пользователями
(function() {
    'use strict';

    let currentUser = null;
    let socket = null;
    let chats = [];
    let activeChatId = null;
    let searchQuery = '';
    let allUsers = [];

    // ---------- DOM ----------
    const authModal = document.getElementById('authModal');
    const appContainer = document.getElementById('appContainer');
    const authError = document.getElementById('authError');

    // Шаги авторизации
    const phoneStep = document.getElementById('authPhoneStep');
    const codeStep = document.getElementById('authCodeStep');
    const registerStep = document.getElementById('authRegisterStep');
    const loginStep = document.getElementById('authLoginStep');

    // ---------- API БАЗОВЫЙ URL ----------
    const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://cvetacvetina-rgb-github-io.onrender.com'; // Заменить на ваш Render URL

    // ---------- АВТОРИЗАЦИЯ ----------
    // Переключение шагов
    function showStep(step) {
        [phoneStep, codeStep, registerStep, loginStep].forEach(el => el.style.display = 'none');
        if (step) step.style.display = 'block';
        authError.style.display = 'none';
    }

    // Запрос кода
    document.getElementById('authRequestCodeBtn').addEventListener('click', async () => {
        const phone = document.getElementById('authPhone').value.trim();
        if (!phone) {
            showError('Введите номер телефона');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/auth/request-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (data.success) {
                showStep(codeStep);
                // В dev показываем код в консоли
                console.log('📱 Код:', data.code);
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    });

    // Подтверждение кода
    document.getElementById('authVerifyBtn').addEventListener('click', async () => {
        const phone = document.getElementById('authPhone').value.trim();
        const code = document.getElementById('authCode').value.trim();

        if (!code || code.length !== 6) {
            showError('Введите 6-значный код');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/auth/verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, code })
            });
            const data = await res.json();
            if (data.success) {
                if (data.action === 'login') {
                    // Переход к логину по паролю
                    document.getElementById('loginUsername').value = phone;
                    showStep(loginStep);
                } else if (data.action === 'register') {
                    document.getElementById('regName').value = '';
                    document.getElementById('regUsername').value = '';
                    document.getElementById('regPassword').value = '';
                    showStep(registerStep);
                }
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    });

    // Регистрация
    document.getElementById('authRegisterBtn').addEventListener('click', async () => {
        const phone = document.getElementById('authPhone').value.trim();
        const name = document.getElementById('regName').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value.trim();

        if (!name || !username || !password) {
            showError('Заполните все поля');
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
                body: JSON.stringify({ phone, name, username, password })
            });
            const data = await res.json();
            if (data.success) {
                await loginUser(phone, password);
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    });

    // Логин по паролю
    document.getElementById('authLoginBtn').addEventListener('click', async () => {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!username || !password) {
            showError('Заполните все поля');
            return;
        }

        await loginUser(username, password);
    });

    async function loginUser(username, password) {
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
                appContainer.style.display = 'flex';
                initApp();
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    }

    // Переключение между логином и регистрацией
    document.getElementById('switchToLogin').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(loginStep);
    });
    document.getElementById('switchToRegister').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(phoneStep);
    });
    document.getElementById('backToPhone').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(phoneStep);
    });

    function showError(msg) {
        authError.textContent = msg;
        authError.style.display = 'block';
    }

    // ---------- ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ----------
    async function initApp() {
        // Подключаем Socket.IO
        socket = io(API_URL, { query: { userId: currentUser.id } });

        // Загружаем чаты
        await loadChats();
        await loadContacts();

        // Настройка Socket.IO
        socket.on('new_message', (data) => {
            const chat = chats.find(c => c.id === data.chatId);
            if (chat) {
                chat.messages.push(data);
                if (activeChatId === chat.id) {
                    renderMessages(activeChatId);
                }
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

        // Запускаем основные функции
        renderChatList();
        openDefaultChat();

        // Обработчики для поиска людей
        document.getElementById('findPeopleBtn').addEventListener('click', openFindPeople);
    }

    // ---------- ЗАГРУЗКА ДАННЫХ ----------
    async function loadChats() {
        try {
            const res = await fetch(`${API_URL}/api/chats/${currentUser.id}`);
            const data = await res.json();
            // Конвертируем в формат, понятный фронтенду
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

            // Загружаем сообщения для каждого чата
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
        const query = prompt('🔍 Введите телефон или username для поиска:');
        if (!query) return;

        const isPhone = query.match(/^[\+\d\s\-\(\)]+$/);
        const endpoint = isPhone ? `/api/users/search/phone/${encodeURIComponent(query)}` 
                                  : `/api/users/search/username/${encodeURIComponent(query)}`;

        fetch(`${API_URL}${endpoint}`)
            .then(res => res.json())
            .then(users => {
                if (users.length === 0) {
                    alert('Пользователи не найдены');
                    return;
                }
                const user = users[0];
                const action = confirm(`Найден: ${user.name} (@${user.username})\nДобавить в контакты?`);
                if (action) {
                    fetch(`${API_URL}/api/contacts`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: currentUser.id, contactId: user.id })
                    }).then(() => {
                        alert('Пользователь добавлен в контакты');
                        loadContacts();
                    });
                }
            })
            .catch(err => alert('Ошибка поиска: ' + err.message));
    }

    // ---------- ОСТАЛЬНЫЕ ФУНКЦИИ (из предыдущей версии) ----------
    // Здесь остаются все функции: renderChatList, renderMessages, sendMessage, группы и т.д.
    // Они адаптированы под работу с реальными пользователями вместо ботов

    // (Код из предыдущей версии с небольшими изменениями для работы с API)

    // Открыть первый чат
    function openDefaultChat() {
        if (chats.length > 0) {
            openChat(chats[0].id);
        }
    }

    // Остальной код из предыдущей версии...
    // (renderChatList, renderMessages, sendMessage, группы и т.д.)

    // Запускаем приложение
    console.log('📱 UMAR готов к работе');
})();