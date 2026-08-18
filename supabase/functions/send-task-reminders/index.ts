import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const REMINDER_TYPE = '30min';
const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM_EMAIL = 'LifeOops <onboarding@resend.dev>';

type TaskRecord = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string | null;
  category: string | null;
  completed: boolean | null;
};

function buildSummary(tasksChecked: number, remindersSent: number, remindersSkipped: number, errors: string[]) {
  return {
    tasksChecked,
    remindersSent,
    remindersSkipped,
    errors,
  };
}

function formatDueDate(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Invalid date';
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date) + ' UTC';
}

function buildEmailHtml(task: TaskRecord, emailAddress: string, dueDisplay: string): string {
  const title = task.title || 'Untitled task';
  const description = task.description || 'No description provided.';
  const priority = task.priority || 'Medium';
  const category = task.category || 'General';

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h2 style="margin-bottom: 16px; color: #111827;">LifeOops Reminder</h2>
      <p style="margin: 0 0 16px;">This task is due in approximately 30 minutes.</p>

      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 12px;">
        <p style="margin: 0 0 8px;"><strong>Task:</strong> ${title}</p>
        <p style="margin: 0 0 8px;"><strong>Description:</strong> ${description}</p>
        <p style="margin: 0 0 8px;"><strong>Due:</strong> ${dueDisplay}</p>
        <p style="margin: 0 0 8px;"><strong>Priority:</strong> ${priority}</p>
        <p style="margin: 0;"><strong>Category:</strong> ${category}</p>
      </div>

      <p style="margin-top: 16px; color: #374151;">To: ${emailAddress}</p>
    </div>
  `;
}

function buildEmailText(task: TaskRecord, dueDisplay: string): string {
  return [
    'LifeOops Reminder',
    '',
    `Task: ${task.title || 'Untitled task'}`,
    `Description: ${task.description || 'No description provided.'}`,
    `Due: ${dueDisplay}`,
    `Priority: ${task.priority || 'Medium'}`,
    `Category: ${task.category || 'General'}`,
    '',
    'This task is due in approximately 30 minutes.',
  ].join('\n');
}

async function sendReminderEmail(apiKey: string, fromEmail: string, emailAddress: string, task: TaskRecord, dueDisplay: string) {
  const subject = `LifeOops Reminder: ${task.title || 'Untitled task'} is due in 30 minutes`;

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [emailAddress],
      subject,
      html: buildEmailHtml(task, emailAddress, dueDisplay),
      text: buildEmailText(task, dueDisplay),
    }),
  });

  const responseJson = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = responseJson?.message || response.statusText || 'Resend request failed';
    throw new Error(`Resend email failed: ${message}`);
  }

  return responseJson;
}

async function getTaskOwnerEmail(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (error) {
    throw new Error(`Unable to resolve user email for ${userId}: ${error.message}`);
  }

  if (!data?.user?.email) {
    throw new Error(`No email available for user ${userId}`);
  }

  return data.user.email;
}

async function reminderAlreadyExists(supabaseAdmin: ReturnType<typeof createClient>, taskId: string, dueAt: string) {
  const { data, error } = await supabaseAdmin
    .from('task_reminders')
    .select('id')
    .eq('task_id', taskId)
    .eq('reminder_type', REMINDER_TYPE)
    .eq('due_at', dueAt)
    .limit(1);

  if (error) {
    throw new Error(`Reminder lookup failed: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

async function recordReminder(supabaseAdmin: ReturnType<typeof createClient>, task: TaskRecord, emailAddress: string) {
  const { error } = await supabaseAdmin.from('task_reminders').insert({
    task_id: task.id,
    user_id: task.user_id,
    reminder_type: REMINDER_TYPE,
    due_at: task.due_date,
    email_address: emailAddress,
  });

  if (error) {
    if (error.code === '23505') {
      return false;
    }

    throw new Error(`Reminder record insert failed: ${error.message}`);
  }

  return true;
}

Deno.serve(async (req: Request) => {
  const summary = {
    tasksChecked: 0,
    remindersSent: 0,
    remindersSkipped: 0,
    errors: [] as string[],
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }

    if (!resendApiKey) {
      throw new Error('Missing RESEND_API_KEY environment variable.');
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const now = new Date();
    const lowerBound = new Date(now.getTime() + 25 * 60 * 1000);
    const upperBound = new Date(now.getTime() + 35 * 60 * 1000);

    const { data: tasks, error: taskQueryError } = await adminClient
      .from('tasks')
      .select('*')
      .eq('completed', false)
      .gte('due_date', lowerBound.toISOString())
      .lte('due_date', upperBound.toISOString());

    if (taskQueryError) {
      throw new Error(`Task query failed: ${taskQueryError.message}`);
    }

    summary.tasksChecked = tasks?.length ?? 0;

    for (const task of (tasks ?? []) as TaskRecord[]) {
      try {
        if (!task?.id || !task?.user_id || !task?.due_date) {
          continue;
        }

        const dueAt = new Date(task.due_date);

        if (Number.isNaN(dueAt.getTime())) {
          summary.errors.push(`Invalid due_date for task ${task.id}`);
          continue;
        }

        const reminderExists = await reminderAlreadyExists(adminClient, task.id, dueAt.toISOString());

        if (reminderExists) {
          summary.remindersSkipped += 1;
          continue;
        }

        const emailAddress = await getTaskOwnerEmail(adminClient, task.user_id);
        const dueDisplay = formatDueDate(task.due_date);

        await sendReminderEmail(
          resendApiKey,
          Deno.env.get('RESEND_FROM_EMAIL') || DEFAULT_FROM_EMAIL,
          emailAddress,
          task,
          dueDisplay,
        );

        const inserted = await recordReminder(adminClient, task, emailAddress);

        if (inserted) {
          summary.remindersSent += 1;
        } else {
          summary.remindersSkipped += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown reminder error';
        summary.errors.push(`${message}`);
      }
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    summary.errors.push(message);

    return new Response(JSON.stringify(summary), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
