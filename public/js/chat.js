/* ===================================================================
   ChatFlow - Main JavaScript
   Real-time Chat with Socket.IO
=================================================================== */

// ===== STATE =====
let currentUser = null;
let socket = null;
let currentChat = { type: 'group', userId: null, userName: null };
let selectedFile = null;
let onlineUsers = [];
let typingTimeout = null;
let isTyping = false;
let lastMessageDate = null;
let oldestMessageId = null;

// ===== API =====
const API = {
  async request(url, options = {}) {
    const token = localStorage.getItem('chat_token');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const res = await fetch(url, { ...options, headers });
    return res.json();
  },
  post(url, data) { return this.request(url, { method: 'POST', body: JSON.stringify(data) }); },
  get(url) { return this.request(url); }
};

// ===== AUTH FUNCTIONS =====
function switchTab(tab) {
  document.getElementById('loginForm').classList.toggle('active', tab === 'login');
  document.getElementById('registerForm').classList.toggle('active', tab === 'register');
  document.getElementById('loginTab').classList.toggle('active', tab === 'login');
  document.getElementById('registerTab').classList.toggle('active', tab === 'register');
  document.getElementById('loginError').textContent = '';
  document.getElementById('registerError').textContent = '';
}

function togglePassword(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');
  
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('span').textContent = 'چاوەڕوانبە...';
  errorEl.textContent = '';

  try {
    const data = await API.post('/api/auth/login', {
      username: document.getElementById('loginUsername').value.trim(),
      password: document.getElementById('loginPassword').value
    });

    if (data.success) {
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_user', JSON.stringify(data.user));
      showToast('بەخێربێیت ' + data.user.full_name, 'success');
      await initChat(data.user);
    } else {
      errorEl.textContent = data.message;
    }
  } catch (err) {
    errorEl.textContent = 'هەڵەی پەیوەندی بە سێرڤەر';
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = 'چوونەژوورەوە';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  const errorEl = document.getElementById('registerError');
  
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('span').textContent = 'چاوەڕوانبە...';
  errorEl.textContent = '';

  try {
    const data = await API.post('/api/auth/register', {
      full_name: document.getElementById('regFullName').value.trim(),
      username: document.getElementById('regUsername').value.trim(),
      email: document.getElementById('regEmail').value.trim(),
      password: document.getElementById('regPassword').value
    });

    if (data.success) {
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_user', JSON.stringify(data.user));
      showToast('تۆمارکردن سەرکەوتوو بوو! بەخێربێیت', 'success');
      await initChat(data.user);
    } else {
      errorEl.textContent = data.message;
    }
  } catch (err) {
    errorEl.textContent = 'هەڵەی پەیوەندی بە سێرڤەر';
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = 'تۆمارکردن';
  }
}

function logout() {
  if (!confirm('دەتەوێت دەربچیت؟')) return;
  if (socket) socket.disconnect();
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_user');
  location.reload();
}

// ===== CHAT INITIALIZATION =====
async function initChat(user) {
  currentUser = user;
  
  // Show chat app
  document.getElementById('authContainer').classList.add('hidden');
  document.getElementById('chatApp').classList.remove('hidden');
  document.body.classList.remove('auth-page');
  
  // Update sidebar user info
  document.getElementById('sidebarName').textContent = user.full_name;
  document.getElementById('sidebarAvatar').textContent = user.full_name[0].toUpperCase();
  if (user.is_admin) {
    document.getElementById('sidebarAvatar').style.background = 'linear-gradient(135deg, #FFD700, #FFA500)';
  }
  
  // Connect socket
  connectSocket();
  
  // Load users list
  await loadUsersList();
  
  // Open group chat by default
  openGroupChat();
}

// ===== SOCKET CONNECTION =====
function connectSocket() {
  const token = localStorage.getItem('chat_token');
  
  socket = io({ auth: { token } });
  
  socket.on('connect', () => {
    console.log('🔌 Socket connected');
  });

  socket.on('connect_error', (err) => {
    showToast('هەڵەی پەیوەندی: ' + err.message, 'error');
  });

  socket.on('online_users', (userIds) => {
    onlineUsers = userIds;
    document.getElementById('onlineBadge').textContent = userIds.length + ' دەستەلێکردوو';
    updateOnlineStatus();
  });

  socket.on('group_message', (msg) => {
    if (currentChat.type === 'group') {
      appendMessage(msg, false);
    }
    if (currentChat.type !== 'group') {
      updateChatPreview('group', msg.content || (msg.message_type === 'image' ? '📷 وینە' : '📄 فایل'));
    }
  });

  socket.on('private_message', (msg) => {
    const isMyChat = (
      (msg.sender_id === currentUser.id && msg.receiver_id === currentChat.userId) ||
      (msg.sender_id === currentChat.userId && msg.receiver_id === currentUser.id)
    );
    
    if (currentChat.type === 'private' && isMyChat) {
      appendMessage(msg, false);
    } else if (msg.sender_id !== currentUser.id) {
      // Unread from other
      updateUnreadBadge(msg.sender_id, 1);
      updateUserPreview(msg.sender_id, msg.content || (msg.message_type === 'image' ? '📷' : '📄'));
    }
  });

  socket.on('new_message_notification', (data) => {
    showToast(`📩 ${data.from_name}: ${data.preview}`, 'info');
  });

  socket.on('user_typing_group', (data) => {
    if (currentChat.type === 'group' && data.user_id !== currentUser.id) {
      showTyping(data.username);
    }
  });

  socket.on('stop_typing_group', (data) => {
    if (currentChat.type === 'group') {
      hideTyping();
    }
  });

  socket.on('user_typing_private', (data) => {
    if (currentChat.type === 'private' && data.user_id === currentChat.userId) {
      showTyping(data.username);
    }
  });

  socket.on('stop_typing_private', (data) => {
    if (currentChat.type === 'private' && data.user_id === currentChat.userId) {
      hideTyping();
    }
  });

  socket.on('error', (data) => {
    showToast(data.message, 'error');
  });
}

// ===== USERS LIST =====
async function loadUsersList() {
  try {
    const data = await API.get('/api/messages/users');
    if (!data.success) return;
    
    const list = document.getElementById('usersList');
    list.innerHTML = '';
    
    data.users.forEach(user => {
      const item = createUserItem(user);
      list.appendChild(item);
    });
  } catch (err) {
    console.error('Load users error:', err);
  }
}

function createUserItem(user) {
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.id = `user_item_${user.id}`;
  div.onclick = () => openPrivateChat(user.id, user.full_name, user.is_admin);
  
  const isOnline = onlineUsers.includes(user.id);
  const avatarLetter = user.full_name[0].toUpperCase();
  const adminCrown = user.is_admin ? '<div class="admin-crown">👑</div>' : '';
  const adminStyle = user.is_admin ? 'background: linear-gradient(135deg, #FFD700, #FFA500);' : '';
  const unreadHidden = (user.unread_count || 0) === 0 ? 'hidden' : '';
  const timeStr = user.last_message_time ? formatTime(new Date(user.last_message_time)) : '';
  
  div.innerHTML = `
    <div class="chat-avatar" style="${adminStyle}">
      ${avatarLetter}
      <div class="status-dot ${isOnline ? 'online' : 'offline'}"></div>
      ${adminCrown}
    </div>
    <div class="chat-info">
      <div class="chat-name">
        ${user.is_admin ? '<span class="admin-badge">ADMIN</span>' : ''}
        ${user.full_name}
      </div>
      <div class="chat-preview" id="preview_${user.id}">${user.last_message || 'دەست بکە بە چات'}</div>
    </div>
    <div class="chat-meta">
      <span class="chat-time" id="time_${user.id}">${timeStr}</span>
      <span class="unread-badge ${unreadHidden}" id="unread_${user.id}">${user.unread_count || 0}</span>
    </div>
  `;
  
  return div;
}

function updateOnlineStatus() {
  document.querySelectorAll('.status-dot').forEach(dot => {
    const item = dot.closest('.chat-item');
    if (!item) return;
    const match = item.id.match(/user_item_(\d+)/);
    if (match) {
      const userId = parseInt(match[1]);
      dot.className = `status-dot ${onlineUsers.includes(userId) ? 'online' : 'offline'}`;
    }
  });
}

function filterChats(query) {
  const items = document.querySelectorAll('#usersList .chat-item');
  items.forEach(item => {
    const name = item.querySelector('.chat-name').textContent.toLowerCase();
    item.style.display = name.includes(query.toLowerCase()) ? '' : 'none';
  });
}

// ===== OPEN CHATS =====
function openGroupChat() {
  currentChat = { type: 'group', userId: null, userName: 'چاتی گرووپ' };
  oldestMessageId = null;
  lastMessageDate = null;
  
  // Update active state
  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
  document.getElementById('groupChatItem').classList.add('active');
  
  // Update header
  document.getElementById('headerAvatar').textContent = '👥';
  document.getElementById('headerAvatar').style.background = 'linear-gradient(135deg, #FF6584, #FF8E53)';
  document.getElementById('headerName').textContent = 'چاتی گرووپ';
  document.getElementById('headerStatus').textContent = 'چاتی گشتی بۆ هەموو';
  
  // Clear messages and load
  clearMessages();
  loadGroupMessages();
  
  // Mobile: hide sidebar
  if (window.innerWidth <= 768) hideSidebarMobile();
}

async function openPrivateChat(userId, userName, isAdmin) {
  currentChat = { type: 'private', userId, userName };
  oldestMessageId = null;
  lastMessageDate = null;
  
  // Update active state
  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
  const item = document.getElementById(`user_item_${userId}`);
  if (item) item.classList.add('active');
  
  // Update header
  const avatarEl = document.getElementById('headerAvatar');
  avatarEl.textContent = userName[0].toUpperCase();
  avatarEl.style.background = isAdmin 
    ? 'linear-gradient(135deg, #FFD700, #FFA500)' 
    : 'linear-gradient(135deg, #6C63FF, #8B85FF)';
  document.getElementById('headerName').innerHTML = 
    `${isAdmin ? '<span class="admin-badge">ADMIN</span>' : ''} ${userName}`;
  
  const isOnline = onlineUsers.includes(userId);
  document.getElementById('headerStatus').textContent = isOnline ? '🟢 دەستەلێکردوو' : '⚫ ئاشکرا نییە';
  
  // Clear unread badge
  clearUnreadBadge(userId);
  
  // Clear messages and load
  clearMessages();
  await loadPrivateMessages(userId);
  
  if (window.innerWidth <= 768) hideSidebarMobile();
}

// ===== LOAD MESSAGES =====
async function loadGroupMessages() {
  try {
    const url = oldestMessageId 
      ? `/api/messages/group?before_id=${oldestMessageId}` 
      : '/api/messages/group';
    const data = await API.get(url);
    if (!data.success) return;
    
    if (data.messages.length > 0) {
      if (!oldestMessageId) {
        // First load
        data.messages.forEach(msg => appendMessage(msg, true));
        scrollToBottom();
      } else {
        // Load more
        prependMessages(data.messages);
      }
      oldestMessageId = data.messages[0]?.id;
    }
  } catch (err) {
    console.error('Load group messages error:', err);
  }
}

async function loadPrivateMessages(userId) {
  try {
    const url = oldestMessageId 
      ? `/api/messages/private/${userId}?before_id=${oldestMessageId}` 
      : `/api/messages/private/${userId}`;
    const data = await API.get(url);
    if (!data.success) return;
    
    if (data.messages.length > 0) {
      if (!oldestMessageId) {
        data.messages.forEach(msg => appendMessage(msg, true));
        scrollToBottom();
      } else {
        prependMessages(data.messages);
      }
      oldestMessageId = data.messages[0]?.id;
    }
  } catch (err) {
    console.error('Load private messages error:', err);
  }
}

function loadMoreMessages() {
  if (!oldestMessageId) return;
  if (currentChat.type === 'group') {
    loadGroupMessages();
  } else {
    loadPrivateMessages(currentChat.userId);
  }
}

// ===== RENDER MESSAGES =====
function clearMessages() {
  const area = document.getElementById('messagesArea');
  area.innerHTML = `
    <div class="welcome-msg" id="welcomeMsg">
      <div class="welcome-icon">💬</div>
      <h3>بەخێربێیت بۆ ChatFlow</h3>
      <p>گرووپ یان کەسێک هەڵبژێرە بۆ دەستپێکردنی چات</p>
    </div>
  `;
  lastMessageDate = null;
}

function appendMessage(msg, isHistorical = false) {
  const area = document.getElementById('messagesArea');
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.remove();
  
  const isSelf = msg.sender_id === currentUser.id;
  const msgDate = new Date(msg.created_at);
  const dateStr = formatDate(msgDate);
  
  // Date separator
  if (lastMessageDate !== dateStr) {
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.textContent = dateStr;
    area.appendChild(sep);
    lastMessageDate = dateStr;
  }
  
  const wrap = document.createElement('div');
  wrap.className = `message-wrap ${isSelf ? 'self' : 'other'}`;
  
  const avatarLetter = msg.full_name ? msg.full_name[0].toUpperCase() : '؟';
  const avatarStyle = msg.is_admin 
    ? 'style="background: linear-gradient(135deg, #FFD700, #FFA500);"' 
    : '';
  
  const senderName = !isSelf 
    ? `<div class="msg-sender-name ${msg.is_admin ? 'msg-admin-name' : ''}">${msg.is_admin ? '👑 ' : ''}${msg.full_name}</div>` 
    : '';
  
  const content = renderMessageContent(msg, isSelf);
  const timeStr = formatTime(msgDate);
  
  wrap.innerHTML = `
    <div class="msg-avatar ${isSelf ? 'hidden-avatar' : ''}" ${avatarStyle} title="${msg.full_name}">
      ${avatarLetter}
    </div>
    <div class="message-bubble ${isSelf ? 'self' : 'other'}">
      ${senderName}
      ${content}
      <div class="msg-time">${timeStr}</div>
    </div>
  `;
  
  area.appendChild(wrap);
  
  if (!isHistorical) {
    scrollToBottom();
    if (!isSelf) wrap.querySelector('.message-bubble').classList.add('unread-incoming');
  }
}

function prependMessages(messages) {
  const area = document.getElementById('messagesArea');
  const firstChild = area.firstChild;
  
  const tempContainer = document.createElement('div');
  const prevDate = null;
  
  messages.forEach(msg => {
    const msgDate = new Date(msg.created_at);
    const dateStr = formatDate(msgDate);
    
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.textContent = dateStr;
    
    const wrap = document.createElement('div');
    const isSelf = msg.sender_id === currentUser.id;
    wrap.className = `message-wrap ${isSelf ? 'self' : 'other'}`;
    
    const avatarLetter = msg.full_name ? msg.full_name[0].toUpperCase() : '؟';
    const avatarStyle = msg.is_admin ? 'style="background: linear-gradient(135deg, #FFD700, #FFA500);"' : '';
    const senderName = !isSelf ? `<div class="msg-sender-name ${msg.is_admin ? 'msg-admin-name' : ''}">${msg.is_admin ? '👑 ' : ''}${msg.full_name}</div>` : '';
    const content = renderMessageContent(msg, isSelf);
    
    wrap.innerHTML = `
      <div class="msg-avatar ${isSelf ? 'hidden-avatar' : ''}" ${avatarStyle}>${avatarLetter}</div>
      <div class="message-bubble ${isSelf ? 'self' : 'other'}">
        ${senderName}${content}
        <div class="msg-time">${formatTime(msgDate)}</div>
      </div>
    `;
    
    area.insertBefore(wrap, firstChild);
    area.insertBefore(sep, wrap);
  });
}

function renderMessageContent(msg, isSelf) {
  if (msg.message_type === 'image' && msg.file_path) {
    return `<img src="${msg.file_path}" class="msg-image" alt="${msg.file_name || 'وینە'}" 
              onclick="openLightbox('${msg.file_path}')" loading="lazy">`;
  }
  
  if (msg.message_type === 'document' && msg.file_path) {
    const sizeStr = formatFileSize(msg.file_size);
    const docIcon = getDocIcon(msg.file_name || '');
    return `
      <a href="${msg.file_path}" class="msg-document" download="${msg.file_name}" target="_blank">
        <span class="doc-icon">${docIcon}</span>
        <div class="doc-info">
          <div class="doc-name">${msg.file_name || 'فایل'}</div>
          <div class="doc-size">${sizeStr}</div>
        </div>
      </a>
    `;
  }
  
  // Text - preserve line breaks and escape HTML
  return `<div class="msg-text">${escapeHtml(msg.content || '').replace(/\n/g, '<br>')}</div>`;
}

// ===== SEND MESSAGE =====
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  
  if (!text && !selectedFile) return;
  if (!socket?.connected) {
    showToast('پەیوەندی بە سێرڤەر نییە', 'error');
    return;
  }
  
  let messageData = {
    content: text || null,
    message_type: 'text'
  };
  
  // Handle file
  if (selectedFile) {
    try {
      const fileData = await uploadFile(selectedFile);
      messageData.message_type = fileData.type;
      messageData.file_path = fileData.path;
      messageData.file_name = fileData.name;
      messageData.file_size = fileData.size;
      messageData.content = text || null;
    } catch (err) {
      showToast('هەڵەی ئاپلۆدی فایل', 'error');
      return;
    }
  }
  
  // Send via socket
  if (currentChat.type === 'group') {
    socket.emit('group_message', messageData);
  } else {
    socket.emit('private_message', {
      ...messageData,
      receiver_id: currentChat.userId
    });
  }
  
  // Reset input
  input.value = '';
  input.style.height = 'auto';
  removeSelectedFile();
  stopTypingSignal();
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const token = localStorage.getItem('chat_token');
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data.file;
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleTyping(textarea) {
  // Auto-resize
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  
  // Typing signal
  if (!isTyping) {
    isTyping = true;
    if (currentChat.type === 'group') {
      socket?.emit('typing_group');
    } else if (currentChat.userId) {
      socket?.emit('typing_private', { to_user_id: currentChat.userId });
    }
  }
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => stopTypingSignal(), 2000);
}

function stopTypingSignal() {
  if (!isTyping) return;
  isTyping = false;
  if (currentChat.type === 'group') {
    socket?.emit('stop_typing_group');
  } else if (currentChat.userId) {
    socket?.emit('stop_typing_private', { to_user_id: currentChat.userId });
  }
}

// ===== FILE HANDLING =====
function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.size > 50 * 1024 * 1024) {
    showToast('فایلەکە گەورەتر از 50MB ە', 'error');
    input.value = '';
    return;
  }
  
  selectedFile = file;
  showFilePreview(file);
}

function showFilePreview(file) {
  const preview = document.getElementById('filePreview');
  const content = document.getElementById('filePreviewContent');
  
  preview.classList.remove('hidden');
  
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      content.innerHTML = `
        <img src="${e.target.result}" class="file-preview-img" alt="preview">
        <div class="file-preview-info">
          <div class="file-preview-name">${file.name}</div>
          <div class="file-preview-size">${formatFileSize(file.size)}</div>
        </div>
      `;
    };
    reader.readAsDataURL(file);
  } else {
    const icon = getDocIcon(file.name);
    content.innerHTML = `
      <span style="font-size:36px">${icon}</span>
      <div class="file-preview-info">
        <div class="file-preview-name">${file.name}</div>
        <div class="file-preview-size">${formatFileSize(file.size)}</div>
      </div>
    `;
  }
}

function removeSelectedFile() {
  selectedFile = null;
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('fileInput').value = '';
}

// ===== UI HELPERS =====
function showTyping(username) {
  document.getElementById('typingText').textContent = `${username} دەنووسێت...`;
  document.getElementById('typingIndicator').classList.remove('hidden');
}

function hideTyping() {
  document.getElementById('typingIndicator').classList.add('hidden');
}

function updateUnreadBadge(userId, count) {
  const badge = document.getElementById(`unread_${userId}`);
  if (badge) {
    const current = parseInt(badge.textContent) || 0;
    badge.textContent = current + count;
    badge.classList.remove('hidden');
  }
}

function clearUnreadBadge(userId) {
  const badge = document.getElementById(`unread_${userId}`);
  if (badge) {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

function updateUserPreview(userId, text) {
  const preview = document.getElementById(`preview_${userId}`);
  if (preview) preview.textContent = text;
  const time = document.getElementById(`time_${userId}`);
  if (time) time.textContent = formatTime(new Date());
}

function updateChatPreview(type, text) {
  if (type === 'group') {
    document.getElementById('groupPreview').textContent = text;
  }
}

function scrollToBottom() {
  const area = document.getElementById('messagesArea');
  area.scrollTop = area.scrollHeight;
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('hidden-mobile');
}

function hideSidebarMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('hidden-mobile');
  }
}

// ===== LIGHTBOX =====
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
}

// ===== TOAST =====
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', error: '❌', info: '💬' };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${message}`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = '0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== UTILS =====
function formatTime(date) {
  return date.toLocaleTimeString('ku', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  
  if (isSameDay(date, today)) return 'ئەمرۆ';
  if (isSameDay(date, yesterday)) return 'دوێنێ';
  
  return date.toLocaleDateString('ku', { year: 'numeric', month: 'long', day: 'numeric' });
}

function isSameDay(d1, d2) {
  return d1.getDate() === d2.getDate() && 
         d1.getMonth() === d2.getMonth() && 
         d1.getFullYear() === d2.getFullYear();
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getDocIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const icons = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    txt: '📃', zip: '🗜', rar: '🗜', default: '📁'
  };
  return icons[ext] || icons.default;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// ===== AUTO-LOGIN =====
window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('chat_token');
  const userStr = localStorage.getItem('chat_user');
  
  if (token && userStr) {
    try {
      const data = await API.get('/api/auth/me');
      if (data.success) {
        await initChat(data.user);
      } else {
        localStorage.removeItem('chat_token');
        localStorage.removeItem('chat_user');
      }
    } catch (err) {
      console.error('Auto-login failed:', err);
    }
  }
});

// Prevent closing lightbox when clicking the image itself
document.addEventListener('DOMContentLoaded', () => {
  const lightboxImg = document.getElementById('lightboxImg');
  if (lightboxImg) {
    lightboxImg.addEventListener('click', (e) => e.stopPropagation());
  }
});
