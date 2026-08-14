const STORAGE_KEY = 'lifeops.tasks';

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

let tasks = loadTasks();
let editingTaskId = null;
let authMode = 'login';
let supabaseClient = null;

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
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
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

  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  userEmailLabel.textContent = session.user?.email || 'Signed in';
  authForm.reset();
  setAuthMessage('');
}

function hideDashboard() {
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

    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        showDashboard();
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

function initAuthUi() {
  authTabs.forEach((tab) => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  });

  authForm.addEventListener('submit', handleAuthSubmit);
  logoutBtn.addEventListener('click', handleLogout);
  setAuthMode('login');
}

function loadTasks() {
  const savedTasks = localStorage.getItem(STORAGE_KEY);
  return savedTasks ? JSON.parse(savedTasks) : [];
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function resetForm() {
  form.reset();
  editingTaskId = null;
  formTitle.textContent = 'Add a task';
  priorityInput.value = 'Medium';
  dueDateInput.value = getTodayString();
}

function getTodayString() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localDate = new Date(today.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split('T')[0];
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

function getSectionTasks(taskList) {
  const todayString = getTodayString();

  return {
    overdue: taskList.filter(task => !task.completed && task.dueDate < todayString),
    today: taskList.filter(task => !task.completed && task.dueDate === todayString),
    upcoming: taskList.filter(task => !task.completed && task.dueDate > todayString),
    completed: taskList.filter(task => task.completed)
  };
}

function updateStats() {
  const total = tasks.length;
  const completed = tasks.filter(task => task.completed).length;
  const pending = tasks.filter(task => !task.completed).length;
  const overdue = tasks.filter(task => !task.completed && task.dueDate < getTodayString()).length;

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

  card.innerHTML = `
    <div class="task-top">
      <h5 class="task-title">${task.title}</h5>
      <span class="meta-pill ${priorityClass}">${task.priority}</span>
    </div>
    <div class="task-meta">
      <span class="meta-pill category-pill">${task.category}</span>
      <span class="meta-pill">${task.completed ? 'Completed' : 'Active'}</span>
    </div>
    <p class="task-description">${task.description || 'No description provided.'}</p>
    <div class="task-footer">
      <span class="due-date">Due: ${formatDate(task.dueDate)}</span>
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

function toggleTaskCompletion(taskId) {
  tasks = tasks.map(task => {
    if (task.id === Number(taskId)) {
      return { ...task, completed: !task.completed };
    }
    return task;
  });

  saveTasks();
  renderAll();
}

function startEdit(taskId) {
  const task = tasks.find(item => item.id === Number(taskId));
  if (!task) return;

  editingTaskId = task.id;
  formTitle.textContent = 'Edit task';
  titleInput.value = task.title;
  descriptionInput.value = task.description;
  dueDateInput.value = task.dueDate;
  priorityInput.value = task.priority;
  categoryInput.value = task.category;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteTask(taskId) {
  const task = tasks.find(item => item.id === Number(taskId));
  if (!task) return;

  const confirmed = window.confirm(`Delete "${task.title}"?`);
  if (!confirmed) return;

  tasks = tasks.filter(item => item.id !== Number(taskId));
  saveTasks();

  if (editingTaskId === Number(taskId)) {
    resetForm();
  }

  renderAll();
}

function renderAll() {
  updateStats();
  updateCategoryFilterOptions();
  renderTaskSections();
}

function handleFormSubmit(event) {
  event.preventDefault();

  const taskData = {
    title: titleInput.value.trim(),
    description: descriptionInput.value.trim(),
    dueDate: dueDateInput.value,
    priority: priorityInput.value,
    category: categoryInput.value.trim() || 'General'
  };

  if (!taskData.title || !taskData.dueDate) {
    alert('Please add a title and a due date.');
    return;
  }

  if (editingTaskId !== null) {
    tasks = tasks.map(task => {
      if (task.id === editingTaskId) {
        return { ...task, ...taskData };
      }
      return task;
    });
  } else {
    tasks.unshift({
      id: Date.now(),
      ...taskData,
      completed: false,
      createdAt: new Date().toISOString()
    });
  }

  saveTasks();
  resetForm();
  renderAll();
}

function initTaskDashboard() {
  dueDateInput.value = getTodayString();

  if (tasks.length === 0) {
    tasks = [
      {
        id: 1,
        title: 'Submit research proposal',
        description: 'Review the final draft and send it to the professor before 5 PM.',
        dueDate: getTodayString(),
        priority: 'High',
        category: 'Study',
        completed: false,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        title: 'Renew gym membership',
        description: 'Complete the online payment before the end of the month.',
        dueDate: '2026-08-20',
        priority: 'Medium',
        category: 'Personal',
        completed: false,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        title: 'Review client feedback',
        description: 'Make a short summary of the latest project comments.',
        dueDate: '2026-08-10',
        priority: 'Low',
        category: 'Work',
        completed: true,
        createdAt: new Date().toISOString()
      }
    ];
    saveTasks();
  }

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

initAuthUi();
initializeAuth();
initTaskDashboard();
