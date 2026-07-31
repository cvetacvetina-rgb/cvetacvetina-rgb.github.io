// script.js — обновлённая логика с поддержкой телефона, email и Google
(function() {
    'use strict';

    let currentUser = null;
    let socket = null;
    let chats = [];
    let activeChatId = null;
    let searchQuery = '';
    let allUsers = [];
    let authContact = '';
    let authType = 'phone'; // 'phone' или 'email'

    // DOM
    const authModal = document.getElementById('authModal');
    const appContainer = document.getElementById('appContainer');
    const authError = document.getElementById('authError');

    const contactStep = document.getElementById('authContactStep');
    const codeStep = document.getElementById('authCodeStep');
    const registerStep = document.getElementById('authRegisterStep');
    const loginStep = document.getElementById('authLoginStep');

    const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://cvetacvetina-rgb-github-io.onrender.com';

    // ---------- ОТОБРАЖЕНИЕ КОДА НА ЭКРАНЕ ----------
    function showCodeOnScreen(code) {
        const display = document.getElementById('codeDisplay');
        const codeSpan = document.getElementById('displayedCode');
        codeSpan.textContent = code;
        display.style.display = 'block';
    }

    // ---------- ПЕРЕКЛЮЧЕНИЕ ШАГОВ ----------
    function showStep(step) {
        [contactStep, codeStep, registerStep, loginStep].forEach(el => el.style.display = 'none');
        if (step) step.style.display = 'block';
        authError.style.display = 'none';
        document.getElementById('codeDisplay').style.display = 'none';
    }

    // ---------- ЗАПРОС КОДА ----------
    async function requestCode(contact, type) {
        if (!contact) {
            showError('Введите телефон или email');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/auth/request-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact, type })
            });
            const data = await res.json();
            if (data.success) {
                authContact = contact;
                authType = type;
                showStep(codeStep);
                // Показываем код на экране (dev режим)
                if (data.code) {
                    showCodeOnScreen(data.code);
                }
                // Автоматически вставляем код в поле (для удобства)
                if (data.code) {
                    document.getElementById('authCode').value = data.code;
                }
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    }

    // ---------- ОБРАБОТЧИКИ ----------
    // Кнопка "Телефон"
    document.getElementById('authPhoneBtn').addEventListener('click', () => {
        authType = 'phone';
        document.getElementById('authContact').placeholder = '+7 999 123 45 67';
        document.getElementById('authContact').value = '';
    });

    // Кнопка "Email"
    document.getElementById('authEmailBtn').addEventListener('click', () => {
        authType = 'email';
        document.getElementById('authContact').placeholder = 'email@example.com';
        document.getElementById('authContact').value = '';
    });

    // Получить код
    document.getElementById('authRequestCodeBtn').addEventListener('click', () => {
        const contact = document.getElementById('authContact').value.trim();
        requestCode(contact, authType);
    });

    // Enter в поле контакта
    document.getElementById('authContact').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('authRequestCodeBtn').click();
        }
    });

    // Подтверждение кода
    document.getElementById('authVerifyBtn').addEventListener('click', async () => {
        const code = document.getElementById('authCode').value.trim();
        if (!code || code.length !== 6) {
            showError('Введите 6-значный код');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/auth/verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact: authContact, code })
            });
            const data = await res.json();
            if (data.success) {
                if (data.action === 'login') {
                    document.getElementById('loginUsername').value = authContact;
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

    // Отправить код снова
    document.getElementById('resendCode').addEventListener('click', (e) => {
        e.preventDefault();
        requestCode(authContact, authType);
    });

    // Назад к контакту
    document.getElementById('backToContact').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(contactStep);
    });

    // Регистрация
    document.getElementById('authRegisterBtn').addEventListener('click', async () => {
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
                body: JSON.stringify({ 
                    contact: authContact, 
                    name, 
                    username, 
                    password, 
                    type: authType 
                })
            });
            const data = await res.json();
            if (data.success) {
                await loginUser(authContact, password);
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    });

    // Логин
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
                authModal.style.display = 'none';
                appContainer.style.display = 'flex';
                initApp();
            } else {
                showError(data.error);
            }
        } catch (err) {
            showError('Ошибка соединения с сервером');
        }
    }

    // Google авторизация
    document.getElementById('authGoogleBtn').addEventListener('click', () => {
        window.location.href = `${API_URL}/api/auth/google`;
    });

    // Переключение между шагами
    document.getElementById('switchToLogin').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(loginStep);
    });
    document.getElementById('switchToRegister').addEventListener('click', (e) => {
        e.preventDefault();
        showStep(contactStep);
    });

    function showError(msg) {
        authError.textContent = msg;
        authError.style.display = 'block';
    }

    // ---------- ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ----------
    async function initApp() {
        // Проверяем Google авторизацию
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'google') {
            const userId = urlParams.get('userId');
            if (userId) {
                const res = await fetch(`${API_URL}/api/users/${userId}`);
                const user = await res.json();
                if (user) {
                    currentUser = user;
                    authModal.classList.remove('active');
                    authModal.style.display = 'none';
                    appContainer.style.display = 'flex';
                    initApp();
                    return;
                }
            }
        }

        // Остальная инициализация
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

    // ... (остальные функции: loadChats, loadContacts, renderChatList, renderMessages, openChat, sendMessage, группы и т.д.)

    // Заглушка для остальных функций
    async function loadChats() {
        // ... (код из предыдущей версии)
    }

    async function loadContacts() {
        // ... (код из предыдущей версии)
    }

    function renderChatList() {
        // ... (код из предыдущей версии)
    }

    function renderMessages(chatId) {
        // ... (код из предыдущей версии)
    }

    function openChat(chatId) {
        // ... (код из предыдущей версии)
    }

    function openDefaultChat() {
        if (chats.length > 0) openChat(chats[0].id);
    }

    function openFindPeople() {
        const query = prompt('🔍 Введите телефон, email или username для поиска:');
        if (!query) return;
        // ... (код поиска)
    }

    console.log('📱 UMAR готов к работе');
})();
