// script.js — логика UMAR (исправлена кнопка входа, добавлен профиль с ID)
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

    // ---------- РЕГИСТРАЦИЯ ----------
    document.getElementById('authRegisterBtn').addEventListener('click', async () => {
        const username = document.getElementById('regUsername').value.trim();
        const name = document.getElementById('regName').value.trim() || username;
        const password = document.getElementById('regPassword').value.trim();
        const avatarFile = document.getElementById('regAvatar').files[0];

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

    // ---------- ВХОД (ИСПРАВЛЕН) ----------
    document.getElementById('authLoginBtn').addEventListener('click', async (e) => {
        e.preventDefault();
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
       
