const STORAGE_KEY = 'lifeops.tasks';
const TASK_TABLE_NAME = 'tasks';
const NOTIFICATION_STORAGE_KEY = 'lifeops.notificationState';
const NOTIFICATION_LEAD_TIME = 15 * 60 * 1000;
const DAILY_MINUTE_LEAD_MS = 60 * 1000;
const OCCASIONAL_DAY_LEAD_MS = 24 * 60 * 60 * 1000;
const OCCASIONAL_15MIN_LEAD_MS = 15 * 60 * 1000;

const authView = document.getElementById('authView');
const appView = document.getElementById('appView');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authName = document.getElementById('authName');
const authNameGroup = document.getElementById('authNameGroup');
const authMessage = document.getElementById('authMessage');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authTabs = document.querySelectorAll('.auth-tab');
const logoutBtn = document.getElementById('logoutBtn');
const userEmailLabel = document.getElementById('userEmailLabel');

const form = document.getElementById('taskForm');
const formTitle = document.getElementById('formTitle');
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const dueDateInput = document.getElementById('dueDate');
const dueTimeInput = document.getElementById('dueTime');
const taskTypeInput = document.getElementById('taskType');
const priorityInput = document.getElementById('priority');
const categoryInput = document.getElementById('category');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const addTaskBtn = document.getElementById('addTaskBtn');
const priorityFilter = document.getElementById('priorityFilter');
const categoryFilter = document.getElementById('categoryFilter');
const taskSections = document.getElementById('taskSections');

const statTotalTasks = document.getElementById('totalTasks');
const statCompletedTasks = document.getElementById('completedTasks');
const statPendingTasks = document.getElementById('pendingTasks');
const statOverdueTasks = document.getElementById('overdueTasks');
const notificationToggleBtn = document.getElementById('notificationToggleBtn');
const notificationStatus = document.getElementById('notificationStatus');
const installPwaBtn = document.getElementById('installPwaBtn');
const sendTestEmailBtn = document.getElementById('sendTestEmailBtn');
const testEmailStatus = document.getElementById('testEmailStatus');

let tasks = [];
let editingTaskId = null;
let authMode = 'login';
let supabaseClient = null;
let currentUser = null;
let countdownIntervalId = null;
let deferredInstallPrompt = null;
let pwaInstallDismissed = false;

function getSupabaseConfig() {
  const globalConfig = window.LIFEOPS_SUPABASE_CONFIG;

  if (!globalConfig || !globalConfig.url || !globalConfig.anonKey) {
    throw new Error('Supabase configuration is missing. Update supabase-config.js with your public project URL and anon key.');
  }

  return globalConfig;
}

function initSupabase() {
  const config = getSupabaseConfig();

  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: window.localStorage
      }
    });
    return;
  }

  throw new Error('Supabase client library failed to load.');
}

function setAuthMessage(message, type = '') {
  authMessage.textContent = message;
  authMessage.className = 'auth-message';

  if (type) {
    authMessage.classList.add(type);
  }
}

async function sendTestEmail() {
  if (!supabaseClient || !currentUser) {
    testEmailStatus.textContent = 'Please log in first.';
    return;
  }

  sendTestEmailBtn.disabled = true;
  testEmailStatus.textContent = 'Sending...';

  try {
    const { error } = await supabaseClient.functions.invoke('resend-email', {
      body: {
        to: '1822007gokul@gmail.com',
        subject: 'LifeOops Email Test',
        html: '<p>LifeOops email notifications are working.</p>'
      }
    });

    if (error) {
      throw error;
    }

    testEmailStatus.textContent = 'Test email sent successfully.';
  } catch (error) {
    console.error('Test email request failed:', error);
    testEmailStatus.textContent = 'Test email failed. Please try again.';
  } finally {
    sendTestEmailBtn.disabled = false;
  }
}

function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
  });

  const isSignup = mode === 'signup';
  authNameGroup.classList.toggle('hidden', !isSignup);
  authSubmitBtn.textContent = isSignup ? 'Create Account' : 'Log In';
  setAuthMessage('');

  if (isSignup) {
    authName.setAttribute('required', 'required');
  } else {
    authName.removeAttribute('required');
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value.trim();
  const name = authName.value.trim();

  if (!email || !password) {
    setAuthMessage('Please enter your email and password.', 'error');
    return;
  }

  if (authMode === 'signup' && !name) {
    setAuthMessage('Please enter your full name.', 'error');
    return;
  }

  const submitButton = authSubmitBtn;
  submitButton.disabled = true;
  submitButton.textContent = authMode === 'signup' ? 'Creating account...' : 'Logging in...';
  setAuthMessage('');

  try {
    if (authMode === 'signup') {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name }
        }
      });

      if (error) throw error;

      if (data.user && !data.session) {
        setAuthMessage('Check your email to confirm your account before logging in.', 'success');
      } else {
        await showDashboard();
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) throw error;
      await showDashboard();
    }
  } catch (error) {
    setAuthMessage(error.message || 'Authentication failed. Please try again.', 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = authMode === 'signup' ? 'Create Account' : 'Log In';
  }
}

function normalizeDbTask(task) {
  const safe = task || {};
  const dueDate = safe.due_date ? new Date(safe.due_date) : new Date();

  return {
    id: safe.id,
    title: safe.title || 'Untitled task',
    description: safe.description || '',
    dueDate: dueDate.toISOString().slice(0, 10),
    dueTime: dueDate.toISOString().slice(11, 16),
    priority: safe.priority || 'Medium',
    category: safe.category || 'General',
    completed: Boolean(safe.completed),
    taskType: 'daily',
    createdAt: new Date().toISOString()
  };
}

function toIsoDueDateValue(task) {
  const dateString = task && task.dueDate ? task.dueDate : getTodayString();
  const timeString = task && task.dueTime ? task.dueTime : '23:59';
  const timestamp = new Date(`${dateString}T${timeString}:00`);
  return timestamp.toISOString();
}

function mapAppTaskToDb(task, userId) {
  const safeTask = normalizeTask(task || {});

  return {
    user_id: userId,
    title: safeTask.title || 'Untitled task',
    description: safeTask.description || '',
    due_date: toIsoDueDateValue(safeTask),
    priority: safeTask.priority || 'Medium',
    category: safeTask.category || 'General',
    completed: Boolean(safeTask.completed)
  };
}

async function fetchUserTasks() {
  if (!supabaseClient || !currentUser) {
    tasks = [];
    return [];
  }

  const { data, error } = await supabaseClient
    .from(TASK_TABLE_NAME)
    .select('*')
    .eq('user_id', currentUser.id)
    .order('due_date', { ascending: true });

  if (error) {
    throw error;
  }

  tasks = (data || []).map(normalizeDbTask);
  return tasks;
}

async function migrateLegacyLocalTasks() {
  if (!supabaseClient || !currentUser) {
    return;
  }

  const localTasks = loadTasks();

  if (!Array.isArray(localTasks) || localTasks.length === 0) {
    return;
  }

  const { data: existingTasks, error: selectError } = await supabaseClient
    .from(TASK_TABLE_NAME)
    .select('id')
    .eq('user_id', currentUser.id);

  if (selectError) {
    throw selectError;
  }

  if (Array.isArray(existingTasks) && existingTasks.length > 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const rowsToInsert = localTasks.map(task => mapAppTaskToDb(task, currentUser.id));

  if (!rowsToInsert.length) {
    return;
  }

  const { error: insertError } = await supabaseClient
    .from(TASK_TABLE_NAME)
    .insert(rowsToInsert);

  if (insertError) {
    throw insertError;
  }

  localStorage.removeItem(STORAGE_KEY);
}

async function showDashboard() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error('Session error:', error);
    hideDashboard();
    return;
  }

  if (!session) {
    hideDashboard();
    return;
  }

  currentUser = session.user;
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  userEmailLabel.textContent = currentUser?.email || 'Signed in';
  authForm.reset();
  setAuthMessage('');

  try {
    await migrateLegacyLocalTasks();
    await fetchUserTasks();
    renderAll();
  } catch (taskError) {
    console.error('Failed to load tasks for current user:', taskError);
    setAuthMessage('Unable to load your tasks right now. Please try again.', 'error');
    tasks = [];
    renderAll();
  }
}

function hideDashboard() {
  currentUser = null;
  tasks = [];
  renderTaskSections();
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  userEmailLabel.textContent = 'Signed in';
}

async function handleLogout() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    setAuthMessage(error.message || 'Logout failed.', 'error');
    return;
  }

  currentUser = null;
  tasks = [];
  renderAll();
  hideDashboard();
  setAuthMode('login');
  authForm.reset();
  setAuthMessage('You have been logged out.', 'success');
}

async function initializeAuth() {
  try {
    initSupabase();

    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error) {
      throw error;
    }

    if (session) {
      await showDashboard();
    } else {
      hideDashboard();
    }

    supabaseClient.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await showDashboard();
      }

      if (event === 'SIGNED_OUT') {
        hideDashboard();
      }
    });
  } catch (error) {
    console.error('Auth initialization failed:', error);
    hideDashboard();
    setAuthMessage('Authentication is unavailable right now. Check your Supabase config.', 'error');
  }
}

function updateInstallButton() {
  if (!installPwaBtn) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (isStandalone || pwaInstallDismissed || !deferredInstallPrompt) {
    installPwaBtn.classList.add('hidden');
    return;
  }

  installPwaBtn.classList.remove('hidden');
  installPwaBtn.textContent = 'Install LifeOops';
}

function handleBeforeInstallPrompt(event) {
  event.preventDefault();

  if (pwaInstallDismissed) {
    return;
  }

  deferredInstallPrompt = event;
  updateInstallButton();
}

async function handleInstallClick() {
  if (!deferredInstallPrompt) {
    return;
  }

  pwaInstallDismissed = true;
  localStorage.setItem('lifeoops.pwa.install.dismissed', 'true');
  installPwaBtn.classList.add('hidden');

  try {
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('PWA installation accepted by the user.');
    } else {
      console.log('PWA installation dismissed by the user.');
    }
  } catch (error) {
    console.error('PWA installation prompt failed:', error);
  }

  deferredInstallPrompt = null;
  updateInstallButton();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.register('./service-worker.js', { scope: './' })
    .then((registration) => {
      console.log('LifeOops Service Worker registered');
      console.log('Service worker scope:', registration.scope);
    })
    .catch((error) => {
      console.error('Service worker registration failed:', error);
    });
}

function setupPwaSupport() {
  pwaInstallDismissed = localStorage.getItem('lifeoops.pwa.install.dismissed') === 'true';

  if (installPwaBtn) {
    installPwaBtn.addEventListener('click', handleInstallClick);
  }

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', () => {
    pwaInstallDismissed = true;
    localStorage.setItem('lifeoops.pwa.install.dismissed', 'true');
    updateInstallButton();
  });

  updateInstallButton();
}

function initAuthUi() {
  authTabs.forEach((tab) => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  });

  authForm.addEventListener('submit', handleAuthSubmit);
  logoutBtn.addEventListener('click', handleLogout);
  sendTestEmailBtn.addEventListener('click', sendTestEmail);
  if (notificationToggleBtn) {
    notificationToggleBtn.addEventListener('click', toggleNotifications);
  }
  updateNotificationUi();
  setAuthMode('login');
}

function loadTasks() {
  const savedTasks = localStorage.getItem(STORAGE_KEY);

  if (!savedTasks) {
    return [];
  }

  try {
    const parsedTasks = JSON.parse(savedTasks);
    return Array.isArray(parsedTasks) ? parsedTasks.map(normalizeTask) : [];
  } catch (error) {
    return [];
  }
}

async function saveTasks() {
  if (!supabaseClient || !currentUser) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.map(normalizeTask)));
    return;
  }

  for (const task of tasks) {
    const dbTask = mapAppTaskToDb(task, currentUser.id);
    const { error } = await supabaseClient
      .from(TASK_TABLE_NAME)
      .upsert({ ...dbTask, id: task.id }, { onConflict: 'id' })
      .eq('user_id', currentUser.id);

    if (error) {
      throw error;
    }
  }
}

function resetForm() {
  form.reset();
  editingTaskId = null;
  formTitle.textContent = 'Add a task';
  taskTypeInput.value = 'daily';
  priorityInput.value = 'Medium';
  dueDateInput.value = getTodayString();
  dueTimeInput.value = getDefaultDueTime();
}

function getTodayString() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localDate = new Date(today.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split('T')[0];
}

function getDefaultDueTime() {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.ceil(minutes / 10) * 10;
  const adjustedHours = roundedMinutes >= 60 ? now.getHours() + 1 : now.getHours();
  const normalizedMinutes = roundedMinutes >= 60 ? 0 : roundedMinutes;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), adjustedHours, normalizedMinutes);

  const hours = String(target.getHours()).padStart(2, '0');
  const mins = String(target.getMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
}

function getTaskDueTime(task) {
  return task && task.dueTime ? task.dueTime : '23:59';
}

function getTimeLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function getTaskDeadline(task) {
  const dateString = task && task.dueDate ? task.dueDate : getTodayString();
  const timeString = getTaskDueTime(task);
  const [year, month, day] = dateString.split('-').map(Number);
  const [hours, minutes] = timeString.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

function clearNotificationStateForTask(taskId) {
  const state = loadNotificationState();
  Object.keys(state).forEach(key => {
    if (key.startsWith(`${taskId}-`)) {
      delete state[key];
    }
  });
  saveNotificationState(state);
}

function formatDate(dateString) {
  if (!dateString) return 'No date';

  const date = new Date(dateString + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function formatDeadline(dateString, timeString) {
  const safeDate = dateString || getTodayString();
  const safeTime = timeString || '23:59';
  const [year, month, day] = safeDate.split('-').map(Number);
  const [hours, minutes] = safeTime.split(':').map(Number);
  const dueDate = new Date(year, month - 1, day, hours, minutes);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(dueDate);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.floor(Math.abs(ms) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 && seconds > 0) parts.push(`${seconds}s`);
  if (parts.length === 0) parts.push('0s');

  return parts.slice(0, 3).join(' ');
}

function getCountdownText(task) {
  if (!task || task.completed) {
    return '✓ Completed';
  }

  const deadline = getTaskDeadline(task);
  const remainingMs = deadline.getTime() - Date.now();

  if (remainingMs <= 0) {
    return `⚠️ Overdue by ${formatDuration(remainingMs)}`;
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);

  if (totalSeconds < 60) {
    return `⏳ ${totalSeconds}s remaining`;
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `⏳ ${days}d ${hours}h ${minutes}m remaining`;
  }

  if (hours > 0) {
    return `⏳ ${hours}h ${minutes}m remaining`;
  }

  return `⏳ ${minutes}m remaining`;
}

function getNotificationLeadTimeMs() {
  return NOTIFICATION_LEAD_TIME;
}

function getTaskType(task) {
  if (!task || task.taskType === 'occasional') {
    return 'occasional';
  }

  return 'daily';
}

function normalizeTask(task) {
  if (!task) return task;

  return {
    ...task,
    dueTime: task.dueTime || '23:59',
    taskType: getTaskType(task)
  };
}

function getNotificationOverride(name, fallbackValue) {
  const overrides = window.LIFEOPS_NOTIFICATION_OVERRIDES || {};
  const value = overrides[name];

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallbackValue;
}

function getReminderText(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

  if (totalSeconds < 60) {
    return 'due in less than a minute.';
  }

  const minutes = Math.max(1, Math.round(totalSeconds / 60));

  if (minutes === 1) {
    return 'due in 1 minute.';
  }

  return `due in ${minutes} minutes.`;
}

function loadNotificationState() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveNotificationState(state) {
  localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state));
}

function getNotificationKey(taskId, reminderType) {
  return `${taskId}-${reminderType}`;
}

function isNotificationSent(taskId, reminderType) {
  const state = loadNotificationState();
  return Boolean(state[getNotificationKey(taskId, reminderType)]);
}

function markNotificationSent(taskId, reminderType) {
  const state = loadNotificationState();
  state[getNotificationKey(taskId, reminderType)] = true;
  saveNotificationState(state);
}

function sendBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    new Notification(title, { body });
  } catch (error) {
    console.error('Notification send failed:', error);
  }
}

function updateNotificationUi() {
  if (!notificationToggleBtn || !notificationStatus) return;

  if (!('Notification' in window)) {
    notificationToggleBtn.disabled = true;
    notificationToggleBtn.textContent = '🔔 Notifications unsupported';
    notificationStatus.textContent = 'Notifications: Unsupported';
    return;
  }

  notificationToggleBtn.disabled = false;

  if (Notification.permission === 'granted') {
    notificationToggleBtn.textContent = '🔔 Notifications Enabled';
    notificationStatus.textContent = 'Notifications: Enabled';
    return;
  }

  if (Notification.permission === 'denied') {
    notificationToggleBtn.textContent = '🔔 Enable Notifications';
    notificationStatus.textContent = 'Notifications blocked. Enable in browser settings.';
    return;
  }

  notificationToggleBtn.textContent = '🔔 Enable Notifications';
  notificationStatus.textContent = 'Notifications: Off';
}

async function toggleNotifications() {
  if (!('Notification' in window)) {
    notificationStatus.textContent = 'Notifications are not supported in this browser.';
    return;
  }

  if (Notification.permission === 'denied') {
    notificationStatus.textContent = 'Notification permission is denied. Enable browser notifications manually in your browser settings.';
    updateNotificationUi();
    return;
  }

  if (Notification.permission === 'granted') {
    notificationStatus.textContent = 'LifeOps notifications enabled.';
    updateNotificationUi();
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    notificationStatus.textContent = 'LifeOps notifications enabled.';
  } else if (permission === 'denied') {
    notificationStatus.textContent = 'Notification permission was denied. Enable browser notifications manually in your browser settings.';
  } else {
    notificationStatus.textContent = 'Notification permission was not granted.';
  }

  updateNotificationUi();
}

function checkTaskNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const now = Date.now();

  tasks.forEach(task => {
    if (!task || task.completed || !task.dueDate || !task.dueTime) {
      return;
    }

    const taskType = getTaskType(task);
    const deadline = getTaskDeadline(task).getTime();
    const remainingTime = deadline - now;

    if (taskType === 'daily') {
      if (!isNotificationSent(task.id, 'daily-1min') && remainingTime > 0 && remainingTime <= getNotificationOverride('dailyLeadMs', DAILY_MINUTE_LEAD_MS) + 15000) {
        sendBrowserNotification('LifeOps Reminder', `${task.title} is due in 1 minute.`);
        markNotificationSent(task.id, 'daily-1min');
        return;
      }

      if (!isNotificationSent(task.id, 'daily-due') && remainingTime <= 0) {
        sendBrowserNotification('LifeOps — Task Due', `${task.title} is due now.`);
        markNotificationSent(task.id, 'daily-due');
      }
      return;
    }

    const oneDayLeadTime = getNotificationOverride('occasionalDayLeadMs', OCCASIONAL_DAY_LEAD_MS);
    const fifteenMinLeadTime = getNotificationOverride('occasional15MinLeadMs', OCCASIONAL_15MIN_LEAD_MS);

    if (!isNotificationSent(task.id, '1day') && remainingTime > 0 && remainingTime <= oneDayLeadTime + 15000 && remainingTime > fifteenMinLeadTime) {
      const dayLabel = getTimeLabel(new Date(deadline));
      sendBrowserNotification('LifeOps — Tomorrow', `${task.title} is tomorrow at ${dayLabel}.`);
      markNotificationSent(task.id, '1day');
      return;
    }

    if (!isNotificationSent(task.id, '15min') && remainingTime > 0 && remainingTime <= fifteenMinLeadTime + 15000 && remainingTime > 0) {
      sendBrowserNotification('LifeOps Reminder', `${task.title} is due in 15 minutes.`);
      markNotificationSent(task.id, '15min');
      return;
    }

    if (!isNotificationSent(task.id, 'due') && remainingTime <= 0) {
      sendBrowserNotification('LifeOps — Task Due', `${task.title} is due now.`);
      markNotificationSent(task.id, 'due');
    }
  });
}

function ensureCountdownTimer() {
  if (countdownIntervalId !== null) return;

  countdownIntervalId = setInterval(() => {
    renderAll();
    checkTaskNotifications();
  }, 1000);
}

function getSectionTasks(taskList) {
  const todayString = getTodayString();
  const now = Date.now();

  return {
    overdue: taskList.filter(task => !task.completed && getTaskDeadline(task).getTime() < now),
    today: taskList.filter(task => !task.completed && task.dueDate === todayString),
    upcoming: taskList.filter(task => !task.completed && task.dueDate > todayString),
    completed: taskList.filter(task => task.completed)
  };
}

function updateStats() {
  const total = tasks.length;
  const completed = tasks.filter(task => task.completed).length;
  const pending = tasks.filter(task => !task.completed).length;
  const overdue = tasks.filter(task => !task.completed && getTaskDeadline(task).getTime() < Date.now()).length;

  statTotalTasks.textContent = total;
  statCompletedTasks.textContent = completed;
  statPendingTasks.textContent = pending;
  statOverdueTasks.textContent = overdue;
}

function updateCategoryFilterOptions() {
  const categories = [...new Set(tasks.map(task => task.category).filter(Boolean))].sort();

  const currentValue = categoryFilter.value;
  categoryFilter.innerHTML = '<option value="All">All categories</option>';

  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });

  if (categories.includes(currentValue)) {
    categoryFilter.value = currentValue;
  } else {
    categoryFilter.value = 'All';
  }
}

function getFilteredTasks() {
  return tasks.filter(task => {
    const matchesPriority = priorityFilter.value === 'All' || task.priority === priorityFilter.value;
    const matchesCategory = categoryFilter.value === 'All' || task.category === categoryFilter.value;
    return matchesPriority && matchesCategory;
  });
}

function createTaskCard(task) {
  const card = document.createElement('article');
  card.className = `task-card ${task.completed ? 'completed' : ''}`;

  const priorityClass = `priority-${task.priority.toLowerCase()}`;
  const dueTime = getTaskDueTime(task);
  const countdownText = getCountdownText(task);
  const taskTypeLabel = getTaskType(task) === 'occasional' ? 'Occasional' : 'Routine / Daily';

  card.innerHTML = `
    <div class="task-top">
      <h5 class="task-title">${task.title}</h5>
      <span class="meta-pill ${priorityClass}">${task.priority}</span>
    </div>
    <div class="task-meta">
      <span class="meta-pill category-pill">${task.category}</span>
      <span class="meta-pill task-type-pill">${taskTypeLabel}</span>
      <span class="meta-pill">${task.completed ? 'Completed' : 'Active'}</span>
    </div>
    <p class="task-description">${task.description || 'No description provided.'}</p>
    <div class="task-footer">
      <div class="task-date-block">
        <span class="due-date">Due: ${formatDeadline(task.dueDate, dueTime)}</span>
        <span class="task-countdown">${countdownText}</span>
      </div>
      <div class="task-actions">
        <button class="action-btn complete-btn" type="button" data-id="${task.id}">
          ${task.completed ? 'Undo' : 'Complete'}
        </button>
        <button class="action-btn edit-btn" type="button" data-id="${task.id}">Edit</button>
        <button class="delete-btn delete-btn-action" type="button" data-id="${task.id}">Delete</button>
      </div>
    </div>
  `;

  return card;
}

function renderSection(title, sectionTasks) {
  const section = document.createElement('section');
  section.className = 'section-card';

  const filteredTasks = sectionTasks.filter(task => {
    const matchesPriority = priorityFilter.value === 'All' || task.priority === priorityFilter.value;
    const matchesCategory = categoryFilter.value === 'All' || task.category === categoryFilter.value;
    return matchesPriority && matchesCategory;
  });

  const list = document.createElement('div');
  list.className = 'task-list';

  if (filteredTasks.length === 0) {
    list.innerHTML = '<div class="empty-state">No tasks here.</div>';
  } else {
    filteredTasks.forEach(task => {
      list.appendChild(createTaskCard(task));
    });
  }

  section.innerHTML = `
    <div class="section-header">
      <h4>${title}</h4>
      <span class="badge">${filteredTasks.length}</span>
    </div>
  `;

  section.appendChild(list);
  return section;
}

function renderTaskSections() {
  const visibleTasks = getFilteredTasks();
  const grouped = getSectionTasks(visibleTasks);

  taskSections.innerHTML = '';

  const orderedSections = [
    { title: 'Overdue', tasks: grouped.overdue },
    { title: 'Today', tasks: grouped.today },
    { title: 'Upcoming', tasks: grouped.upcoming },
    { title: 'Completed', tasks: grouped.completed }
  ];

  orderedSections.forEach(section => {
    taskSections.appendChild(renderSection(section.title, section.tasks));
  });

  attachCardEvents();
}

function attachCardEvents() {
  document.querySelectorAll('.complete-btn').forEach(button => {
    button.addEventListener('click', () => toggleTaskCompletion(button.dataset.id));
  });

  document.querySelectorAll('.edit-btn').forEach(button => {
    button.addEventListener('click', () => startEdit(button.dataset.id));
  });

  document.querySelectorAll('.delete-btn-action').forEach(button => {
    button.addEventListener('click', () => deleteTask(button.dataset.id));
  });
}

async function toggleTaskCompletion(taskId) {
  const task = tasks.find(item => String(item.id) === String(taskId));

  if (!task || !currentUser || !supabaseClient) {
    return;
  }

  const nextCompletedStatus = !task.completed;

  const { error } = await supabaseClient
    .from(TASK_TABLE_NAME)
    .update({
      completed: nextCompletedStatus
    })
    .eq('id', task.id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Task completion update failed:', error);
    setAuthMessage('Unable to update the task status right now.', 'error');
    return;
  }

  if (nextCompletedStatus) {
    clearNotificationStateForTask(task.id);
  }

  tasks = tasks.map(item => {
    if (String(item.id) === String(taskId)) {
      return { ...item, completed: nextCompletedStatus };
    }
    return item;
  });

  renderAll();
}

function startEdit(taskId) {
  const task = tasks.find(item => String(item.id) === String(taskId));
  if (!task) return;

  editingTaskId = task.id;
  formTitle.textContent = 'Edit task';
  titleInput.value = task.title;
  descriptionInput.value = task.description;
  dueDateInput.value = task.dueDate;
  dueTimeInput.value = getTaskDueTime(task);
  taskTypeInput.value = getTaskType(task) === 'occasional' ? 'occasional' : 'daily';
  priorityInput.value = task.priority;
  categoryInput.value = task.category;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteTask(taskId) {
  const task = tasks.find(item => String(item.id) === String(taskId));
  if (!task || !currentUser || !supabaseClient) return;

  const confirmed = window.confirm(`Delete "${task.title}"?`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from(TASK_TABLE_NAME)
    .delete()
    .eq('id', task.id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Task deletion failed:', error);
    setAuthMessage('Unable to delete the task right now.', 'error');
    return;
  }

  clearNotificationStateForTask(task.id);
  tasks = tasks.filter(item => String(item.id) !== String(taskId));

  if (editingTaskId === task.id) {
    resetForm();
  }

  renderAll();
}

function renderAll() {
  updateStats();
  updateCategoryFilterOptions();
  renderTaskSections();
  ensureCountdownTimer();
}

async function handleFormSubmit(event) {
  event.preventDefault();

  if (!currentUser || !supabaseClient) {
    setAuthMessage('Please log in to add tasks.', 'error');
    return;
  }

  const taskData = {
    title: titleInput.value.trim(),
    description: descriptionInput.value.trim(),
    dueDate: dueDateInput.value,
    dueTime: dueTimeInput.value,
    taskType: taskTypeInput.value === 'occasional' ? 'occasional' : 'daily',
    priority: priorityInput.value,
    category: categoryInput.value.trim() || 'General'
  };

  if (!taskData.title || !taskData.dueDate || !taskData.dueTime) {
    alert('Please add a title, a due date, and a due time.');
    return;
  }

  const dbTask = mapAppTaskToDb(taskData, currentUser.id);

  try {
    if (editingTaskId !== null) {
      clearNotificationStateForTask(editingTaskId);

      const { error } = await supabaseClient
        .from(TASK_TABLE_NAME)
        .update({
          ...dbTask,
          due_date: toIsoDueDateValue(taskData),
          priority: taskData.priority,
          category: taskData.category,
          completed: Boolean(taskData.completed)
        })
        .eq('id', editingTaskId)
        .eq('user_id', currentUser.id);

      if (error) {
        throw error;
      }

      tasks = tasks.map(task => {
        if (String(task.id) === String(editingTaskId)) {
          return {
            ...task,
            title: taskData.title,
            description: taskData.description,
            dueDate: taskData.dueDate,
            dueTime: taskData.dueTime,
            priority: taskData.priority,
            category: taskData.category,
            taskType: taskData.taskType,
            completed: Boolean(task.completed)
          };
        }
        return task;
      });
    } else {
      const { data, error } = await supabaseClient
        .from(TASK_TABLE_NAME)
        .insert([dbTask])
        .select();

      if (error) {
        throw error;
      }

      if (data && data[0]) {
        tasks.unshift(normalizeDbTask(data[0]));
      }
    }

    resetForm();
    renderAll();
  } catch (error) {
    console.error('Task save failed:', error);
    setAuthMessage('Your task could not be saved. Please try again.', 'error');
  }
}

function initTaskDashboard() {
  dueDateInput.value = getTodayString();
  dueTimeInput.value = getDefaultDueTime();
  taskTypeInput.value = 'daily';
  updateNotificationUi();
  renderAll();
}

addTaskBtn.addEventListener('click', () => {
  resetForm();
  titleInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

cancelEditBtn.addEventListener('click', () => {
  resetForm();
});

priorityFilter.addEventListener('change', renderTaskSections);
categoryFilter.addEventListener('change', renderTaskSections);
form.addEventListener('submit', handleFormSubmit);

registerServiceWorker();
setupPwaSupport();
initAuthUi();
initializeAuth();
initTaskDashboard();
