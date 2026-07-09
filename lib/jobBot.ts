import { getSupabaseAdmin } from './supabaseAdmin';
import { sendWhatsAppInteractiveButtons, sendWhatsAppText } from './whatsapp';

type ConversationStateName = 'collecting_job' | 'confirming_job';

type IncomingWhatsAppMessage = {
  from: string;
  name: string;
  text: string;
  messageId: string;
  timestamp: string;
};

type UserRecord = {
  id: string;
  phone: string;
  name: string | null;
  role: 'poster' | 'tech' | 'admin' | null;
  skills: string[] | null;
  trusted: boolean | null;
};

type JobRecord = {
  id: string;
  title: string | null;
  event_date: string | null;
  location: string | null;
  call_time: string | null;
  finish_time: string | null;
  role_needed: string | null;
  rate: string | null;
  notes: string | null;
  posted_by_phone: string;
  posted_by_name: string | null;
  status: 'draft' | 'open' | 'closed' | 'cancelled' | null;
  created_at?: string | null;
};

type JobResponseRecord = {
  id: string;
  job_id: string;
  tech_phone: string;
  tech_name: string | null;
  response: 'yes' | 'no' | 'maybe';
};

type ConversationStateRecord = {
  phone: string;
  state: ConversationStateName;
  data: Record<string, unknown> | null;
};

type ParsedJobDetails = {
  title: string;
  event_date: string;
  location: string;
  call_time: string;
  finish_time: string;
  role_needed: string;
  rate: string;
  notes: string;
};

type TechMatch = {
  phone: string;
  name: string | null;
  skills: string[] | null;
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function displayPhone(phone: string): string {
  const digits = normalizePhone(phone);
  return digits ? `+${digits}` : phone;
}

function normalizeText(text: string): string {
  return text.trim().toUpperCase();
}

function startsWithCommand(text: string, command: string): boolean {
  return normalizeText(text).startsWith(`${command} `) || normalizeText(text) === command;
}

function toWaMeLink(phone: string, message: string): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseDetailsBlock(text: string): ParsedJobDetails | null {
  const sections: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (match) {
      currentKey = match[1].trim().toLowerCase();
      sections[currentKey] = match[2].trim();
      continue;
    }

    if (currentKey) {
      sections[currentKey] = `${sections[currentKey]}\n${line}`.trim();
    }
  }

  const title = sections.event ?? sections.title ?? '';
  const eventDate = sections.date ?? '';
  const location = sections.location ?? '';
  const callTime = sections['call time'] ?? sections.call ?? '';
  const finishTime = sections['finish time'] ?? sections.finish ?? '';
  const roleNeeded = sections.role ?? sections['role needed'] ?? '';
  const rate = sections.rate ?? '';
  const notes = sections.notes ?? '';

  const missing: string[] = [];

  if (!title) missing.push('Event');
  if (!eventDate) missing.push('Date');
  if (!location) missing.push('Location');
  if (!callTime) missing.push('Call time');
  if (!finishTime) missing.push('Finish time');
  if (!roleNeeded) missing.push('Role');
  if (!rate) missing.push('Rate');

  if (missing.length > 0) {
    return null;
  }

  return {
    title,
    event_date: eventDate,
    location,
    call_time: callTime,
    finish_time: finishTime,
    role_needed: roleNeeded,
    rate,
    notes,
  };
}

function buildJobSummary(job: JobRecord): string {
  return [
    'Draft job ready:',
    '',
    `Event: ${job.title ?? ''}`,
    `Date: ${job.event_date ?? ''}`,
    `Location: ${job.location ?? ''}`,
    `Call time: ${job.call_time ?? ''}`,
    `Finish time: ${job.finish_time ?? ''}`,
    `Role: ${job.role_needed ?? ''}`,
    `Rate: ${job.rate ?? ''}`,
    `Notes: ${job.notes ?? ''}`,
  ].join('\n');
}

function buildFullJobRecap(job: JobRecord): string {
  return [
    `Event: ${job.title ?? ''}`,
    `Date: ${job.event_date ?? ''}`,
    `Location: ${job.location ?? ''}`,
    `Call: ${job.call_time ?? ''}`,
    `Finish: ${job.finish_time ?? ''}`,
    `Role: ${job.role_needed ?? ''}`,
    `Rate: ${job.rate ?? ''}`,
    `Notes: ${job.notes ?? ''}`,
  ].join('\n');
}

function skillMatches(roleNeeded: string | null, skills: string[] | null): boolean {
  if (!roleNeeded || !skills || skills.length === 0) {
    return false;
  }

  const normalizedRole = roleNeeded.trim().toLowerCase();
  return skills.some((skill) => {
    const normalizedSkill = skill.trim().toLowerCase();
    return (
      normalizedSkill === normalizedRole ||
      normalizedRole.includes(normalizedSkill) ||
      normalizedSkill.includes(normalizedRole)
    );
  });
}

async function markProcessedMessage(messageId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from('processed_messages')
    .select('id')
    .eq('whatsapp_message_id', messageId)
    .maybeSingle();

  if (existing.error) {
    console.error('[jobBot] Failed to check processed message', existing.error);
    throw existing.error;
  }

  if (existing.data) {
    return false;
  }

  const inserted = await supabase
    .from('processed_messages')
    .insert({ whatsapp_message_id: messageId });

  if (inserted.error) {
    if (inserted.error.code === '23505') {
      return false;
    }

    console.error('[jobBot] Failed to record processed message', inserted.error);
    throw inserted.error;
  }

  return true;
}

async function getUserByPhone(phone: string): Promise<UserRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, name, role, skills, trusted')
    .eq('phone', normalizePhone(phone))
    .maybeSingle();

  if (error) {
    console.error('[jobBot] Failed to load user', error);
    throw error;
  }

  return data ?? null;
}

async function upsertUser(phone: string, name: string | null, updates: Partial<UserRecord>): Promise<UserRecord> {
  const supabase = getSupabaseAdmin();
  const normalizedPhone = normalizePhone(phone);
  const existing = await getUserByPhone(normalizedPhone);

  const payload = {
    phone: normalizedPhone,
    name: name ?? existing?.name ?? null,
    role: updates.role ?? existing?.role ?? 'poster',
    skills: updates.skills ?? existing?.skills ?? [],
    trusted: updates.trusted ?? existing?.trusted ?? false,
  };

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'phone' })
    .select('id, phone, name, role, skills, trusted')
    .single();

  if (error) {
    console.error('[jobBot] Failed to upsert user', error);
    throw error;
  }

  return data;
}

async function getConversationState(phone: string): Promise<ConversationStateRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('conversation_states')
    .select('phone, state, data')
    .eq('phone', normalizePhone(phone))
    .maybeSingle();

  if (error) {
    console.error('[jobBot] Failed to load conversation state', error);
    throw error;
  }

  return data ?? null;
}

async function setConversationState(
  phone: string,
  state: ConversationStateName,
  data: Record<string, unknown> = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const payload = {
    phone: normalizePhone(phone),
    state,
    data,
    updated_at: nowIso(),
  };

  const { error } = await supabase.from('conversation_states').upsert(payload, {
    onConflict: 'phone',
  });

  if (error) {
    console.error('[jobBot] Failed to set conversation state', error);
    throw error;
  }
}

async function clearConversationState(phone: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('conversation_states')
    .delete()
    .eq('phone', normalizePhone(phone));

  if (error) {
    console.error('[jobBot] Failed to clear conversation state', error);
    throw error;
  }
}

async function deleteDraftJob(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('jobs').delete().eq('id', jobId).eq('status', 'draft');

  if (error) {
    console.error('[jobBot] Failed to delete draft job', error);
    throw error;
  }
}

async function saveDraftJob(phone: string, name: string, details: ParsedJobDetails, jobId?: string) {
  const supabase = getSupabaseAdmin();
  const payload = {
    title: details.title,
    event_date: details.event_date,
    location: details.location,
    call_time: details.call_time,
    finish_time: details.finish_time,
    role_needed: details.role_needed,
    rate: details.rate,
    notes: details.notes,
    posted_by_phone: normalizePhone(phone),
    posted_by_name: name || null,
    status: 'draft' as const,
  };

  if (jobId) {
    const { data, error } = await supabase
      .from('jobs')
      .update(payload)
      .eq('id', jobId)
      .select('id, title, event_date, location, call_time, finish_time, role_needed, rate, notes, posted_by_phone, posted_by_name, status, created_at')
      .single();

    if (error) {
      console.error('[jobBot] Failed to update draft job', error);
      throw error;
    }

    return data;
  }

  const { data, error } = await supabase
    .from('jobs')
    .insert(payload)
    .select('id, title, event_date, location, call_time, finish_time, role_needed, rate, notes, posted_by_phone, posted_by_name, status, created_at')
    .single();

  if (error) {
    console.error('[jobBot] Failed to create draft job', error);
    throw error;
  }

  return data;
}

async function getJobByIdOrPrefix(jobRef: string): Promise<JobRecord | null> {
  const supabase = getSupabaseAdmin();
  const reference = jobRef.trim();

  const exact = await supabase
    .from('jobs')
    .select('id, title, event_date, location, call_time, finish_time, role_needed, rate, notes, posted_by_phone, posted_by_name, status, created_at')
    .eq('id', reference)
    .maybeSingle();

  if (exact.error) {
    console.error('[jobBot] Failed to fetch exact job', exact.error);
    throw exact.error;
  }

  if (exact.data) {
    return exact.data;
  }

  const prefix = await supabase
    .from('jobs')
    .select('id, title, event_date, location, call_time, finish_time, role_needed, rate, notes, posted_by_phone, posted_by_name, status, created_at')
    .ilike('id', `${reference}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prefix.error) {
    console.error('[jobBot] Failed to fetch prefix job', prefix.error);
    throw prefix.error;
  }

  return prefix.data ?? null;
}

async function listTrustedTechs(): Promise<TechMatch[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('users')
    .select('phone, name, skills')
    .eq('role', 'tech')
    .eq('trusted', true)
    .order('name', { ascending: true });

  if (error) {
    console.error('[jobBot] Failed to load trusted techs', error);
    throw error;
  }

  return (data ?? []) as TechMatch[];
}

async function listOpenJobs(limit = 10): Promise<JobRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, event_date, location, call_time, finish_time, role_needed, rate, notes, posted_by_phone, posted_by_name, status, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[jobBot] Failed to load open jobs', error);
    throw error;
  }

  return (data ?? []) as JobRecord[];
}

async function recordJobDelivery(jobId: string, techPhone: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('job_deliveries')
    .upsert({ job_id: jobId, tech_phone: normalizePhone(techPhone) }, { onConflict: 'job_id,tech_phone' });

  if (error) {
    console.error('[jobBot] Failed to record job delivery', error);
    throw error;
  }
}

async function getLatestOpenJobForTech(techPhone: string): Promise<JobRecord | null> {
  const supabase = getSupabaseAdmin();
  const normalizedPhone = normalizePhone(techPhone);

  const { data: deliveryRows, error: deliveryError } = await supabase
    .from('job_deliveries')
    .select('job_id, sent_at')
    .eq('tech_phone', normalizedPhone)
    .order('sent_at', { ascending: false })
    .limit(1);

  if (deliveryError) {
    console.error('[jobBot] Failed to load latest delivery', deliveryError);
    throw deliveryError;
  }

  const delivery = deliveryRows?.[0];
  if (delivery) {
    const job = await getJobByIdOrPrefix(delivery.job_id);
    if (job && job.status === 'open') {
      return job;
    }
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, event_date, location, call_time, finish_time, role_needed, rate, notes, posted_by_phone, posted_by_name, status, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[jobBot] Failed to load fallback open job', error);
    throw error;
  }

  return data ?? null;
}

async function saveJobResponse(jobId: string, techPhone: string, techName: string, response: 'yes' | 'no' | 'maybe') {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('job_responses')
    .upsert(
      {
        job_id: jobId,
        tech_phone: normalizePhone(techPhone),
        tech_name: techName || null,
        response,
      },
      { onConflict: 'job_id,tech_phone' },
    )
    .select('id, job_id, tech_phone, tech_name, response')
    .single();

  if (error) {
    console.error('[jobBot] Failed to save job response', error);
    throw error;
  }

  return data;
}

async function getPosterByPhone(phone: string): Promise<UserRecord | null> {
  return getUserByPhone(phone);
}

async function sendJobToTechs(job: JobRecord): Promise<TechMatch[]> {
  const trustedTechs = await listTrustedTechs();
  const matchedTechs = trustedTechs.filter((tech) => skillMatches(job.role_needed, tech.skills));
  const recipients = matchedTechs.length > 0 ? matchedTechs : trustedTechs;

  const recap = buildFullJobRecap(job);
  const message = `🎧 NEW JOB\n\n${recap}\n\nReply YES if available.`;

  const results = await Promise.allSettled(
    recipients.map(async (tech) => {
      await sendWhatsAppText(tech.phone, message);
      await recordJobDelivery(job.id, tech.phone);
      return tech;
    }),
  );

  const successfulRecipients = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return [recipients[index]];
    }

    console.error('[jobBot] Failed to send job to tech', {
      techPhone: recipients[index]?.phone,
      error: result.reason,
    });
    return [];
  });

  return successfulRecipients;
}

async function handleAdminCommand(from: string, text: string): Promise<boolean> {
  const normalized = normalizeText(text);
  const supabase = getSupabaseAdmin();

  const user = await getUserByPhone(from);
  if (user?.role !== 'admin') {
    return false;
  }

  if (normalized.startsWith('ADD TECH ')) {
    const [, , phoneRaw, ...rest] = text.trim().split(/\s+/);
    if (!phoneRaw) {
      await sendWhatsAppText(from, 'Usage: ADD TECH +447700900000 John audio,video');
      return true;
    }

    const normalizedPhone = normalizePhone(phoneRaw);
    const techName = rest.length === 0 ? null : rest.length === 1 ? rest[0].trim() || null : rest.slice(0, -1).join(' ').trim() || null;
    const skillsToken = rest.length > 1 ? rest[rest.length - 1] : '';
    const skills =
      rest.length > 1
        ? skillsToken.split(',').map((skill) => skill.trim().toLowerCase()).filter(Boolean)
        : [];

    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          phone: normalizedPhone,
          name: techName,
          role: 'tech',
          skills,
          trusted: true,
        },
        { onConflict: 'phone' },
      )
      .select('phone, name, skills')
      .single();

    if (error) {
      console.error('[jobBot] Failed to add tech', error);
      await sendWhatsAppText(from, 'Could not add tech. Check the number and try again.');
      return true;
    }

    await sendWhatsAppText(
      from,
      `Added tech ${displayPhone(data.phone)}${data.name ? ` (${data.name})` : ''}.`,
    );
    return true;
  }

  if (normalized.startsWith('REMOVE TECH ')) {
    const [, , phoneRaw] = text.trim().split(/\s+/);
    if (!phoneRaw) {
      await sendWhatsAppText(from, 'Usage: REMOVE TECH +447700900000');
      return true;
    }

    const normalizedPhone = normalizePhone(phoneRaw);
    const { error } = await supabase
      .from('users')
      .update({ trusted: false, role: 'tech' })
      .eq('phone', normalizedPhone);

    if (error) {
      console.error('[jobBot] Failed to remove tech', error);
      await sendWhatsAppText(from, 'Could not remove tech. Check the number and try again.');
      return true;
    }

    await sendWhatsAppText(from, `Removed trusted access for ${displayPhone(normalizedPhone)}.`);
    return true;
  }

  if (normalized === 'LIST TECHS') {
    const techs = await listTrustedTechs();

    if (techs.length === 0) {
      await sendWhatsAppText(from, 'No trusted techs are currently configured.');
      return true;
    }

    const lines = techs.map((tech) => {
      const skills = tech.skills?.length ? tech.skills.join(', ') : 'no skills';
      return `${displayPhone(tech.phone)}${tech.name ? ` (${tech.name})` : ''} - ${skills}`;
    });

    await sendWhatsAppText(from, ['Trusted techs:', ...lines].join('\n'));
    return true;
  }

  if (normalized === 'LIST JOBS') {
    const jobs = await listOpenJobs(10);

    if (jobs.length === 0) {
      await sendWhatsAppText(from, 'No open jobs.');
      return true;
    }

    const lines = jobs.map((job) => {
      const jobId = job.id.slice(0, 8);
      return `${jobId} - ${job.title ?? ''} - ${job.location ?? ''} - ${job.role_needed ?? ''}`;
    });

    await sendWhatsAppText(from, ['Latest open jobs:', ...lines].join('\n'));
    return true;
  }

  if (normalized.startsWith('CLOSE JOB ')) {
    const jobRef = text.trim().slice('CLOSE JOB'.length).trim();
    if (!jobRef) {
      await sendWhatsAppText(from, 'Usage: CLOSE JOB <job_id or short id>');
      return true;
    }

    const job = await getJobByIdOrPrefix(jobRef);
    if (!job) {
      await sendWhatsAppText(from, `No job found for ${jobRef}.`);
      return true;
    }

    const { error } = await supabase.from('jobs').update({ status: 'closed' }).eq('id', job.id);
    if (error) {
      console.error('[jobBot] Failed to close job', error);
      await sendWhatsAppText(from, 'Could not close the job.');
      return true;
    }

    await sendWhatsAppText(from, `Closed job ${job.id.slice(0, 8)}.`);
    return true;
  }

  return false;
}

async function handleCollectingJobState(
  from: string,
  name: string,
  text: string,
  state: ConversationStateRecord | null,
): Promise<boolean> {
  if (!state || state.state !== 'collecting_job') {
    return false;
  }

  const details = parseDetailsBlock(text);
  if (!details) {
    await sendWhatsAppText(
      from,
      'I could not parse that job. Please resend it in this format:\n\nEvent:\nDate:\nLocation:\nCall time:\nFinish time:\nRole:\nRate:\nNotes:',
    );
    return true;
  }

  const draftJob = await saveDraftJob(from, name, details, typeof state.data?.job_id === 'string' ? state.data.job_id : undefined);

  await setConversationState(from, 'confirming_job', { job_id: draftJob.id });

  await sendWhatsAppInteractiveButtons(from, buildJobSummary(draftJob), [
    { id: 'POST', title: 'POST' },
    { id: 'EDIT', title: 'EDIT' },
    { id: 'CANCEL', title: 'CANCEL' },
  ]);

  return true;
}

async function handleConfirmingJobState(
  from: string,
  text: string,
  state: ConversationStateRecord | null,
): Promise<boolean> {
  if (!state || state.state !== 'confirming_job') {
    return false;
  }

  const normalized = normalizeText(text);
  const jobId = typeof state.data?.job_id === 'string' ? state.data.job_id : null;

  if (normalized === 'EDIT') {
    await setConversationState(from, 'collecting_job', { job_id: jobId });
    await sendWhatsAppText(
      from,
      'Send the full job details again in the same format:\n\nEvent:\nDate:\nLocation:\nCall time:\nFinish time:\nRole:\nRate:\nNotes:',
    );
    return true;
  }

  if (normalized === 'CANCEL') {
    if (jobId) {
      await deleteDraftJob(jobId);
    }
    await clearConversationState(from);
    await sendWhatsAppText(from, 'Cancelled. No job was posted.');
    return true;
  }

  if (normalized === 'POST') {
    if (!jobId) {
      await sendWhatsAppText(from, 'I could not find the draft job. Please start again with NEW JOB.');
      await clearConversationState(from);
      return true;
    }

    const job = await getJobByIdOrPrefix(jobId);
    if (!job) {
      await sendWhatsAppText(from, 'I could not find the draft job. Please start again with NEW JOB.');
      await clearConversationState(from);
      return true;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('jobs').update({ status: 'open' }).eq('id', job.id);
    if (error) {
      console.error('[jobBot] Failed to open job', error);
      await sendWhatsAppText(from, 'Could not post the job.');
      return true;
    }

    const recipients = await sendJobToTechs({ ...job, status: 'open' });
    await clearConversationState(from);
    await sendWhatsAppText(from, `Posted. I sent this to ${recipients.length} trusted techs.`);
    return true;
  }

  return false;
}

async function handleTechYesFlow(from: string, text: string): Promise<boolean> {
  const user = await getUserByPhone(from);
  if (!user || user.role !== 'tech' || !user.trusted) {
    return false;
  }

  if (!/^YES(\b|\s|!|$)/i.test(text.trim())) {
    return false;
  }

  const job = await getLatestOpenJobForTech(from);
  if (!job) {
    await sendWhatsAppText(from, 'No open jobs are available right now.');
    return true;
  }

  await saveJobResponse(job.id, from, user.name ?? displayPhone(from), 'yes');

  const poster = await getPosterByPhone(job.posted_by_phone);
  if (!poster) {
    await sendWhatsAppText(from, 'I accepted the job, but I could not find the poster details.');
    return true;
  }

  const recap = buildFullJobRecap(job);
  const techName = user.name ?? displayPhone(from);
  const posterMessage = [
    `${techName} is available for your job:`,
    '',
    recap,
    '',
    `Message them:`,
    toWaMeLink(from, `Hi ${techName}, thanks for accepting the ${job.title ?? 'job'} job`),
  ].join('\n');

  const techMessage = [
    'You accepted this job:',
    '',
    recap,
    '',
    'Message the poster:',
    toWaMeLink(job.posted_by_phone, `Hi, I am available for the ${job.title ?? 'job'} job`),
  ].join('\n');

  await sendWhatsAppText(poster.phone, posterMessage);
  await sendWhatsAppText(from, techMessage);

  return true;
}

async function handleDefaultReply(from: string): Promise<void> {
  await sendWhatsAppText(from, 'Hi. Send NEW JOB to create a job request, or YES to accept the latest open job.');
}

export async function handleIncomingWhatsAppMessage({
  from,
  name,
  text,
  messageId,
  timestamp,
}: IncomingWhatsAppMessage): Promise<void> {
  const normalizedFrom = normalizePhone(from);

  console.log('[jobBot] Incoming message', {
    from: normalizedFrom,
    name,
    text,
    messageId,
    timestamp,
  });

  try {
    const isNewMessage = await markProcessedMessage(messageId);
    if (!isNewMessage) {
      console.log('[jobBot] Duplicate message ignored', { messageId, from: normalizedFrom });
      return;
    }

    await upsertUser(normalizedFrom, name || null, {});
    const state = await getConversationState(normalizedFrom);

    if (startsWithCommand(text, 'NEW JOB')) {
      if (state?.data?.job_id && typeof state.data.job_id === 'string') {
        await deleteDraftJob(state.data.job_id);
      }

      await setConversationState(normalizedFrom, 'collecting_job', {});
      await sendWhatsAppText(
        normalizedFrom,
        'Great. Send me the job details like this:\n\nEvent:\nDate:\nLocation:\nCall time:\nFinish time:\nRole:\nRate:\nNotes:',
      );
      return;
    }

    if (await handleAdminCommand(normalizedFrom, text)) {
      return;
    }

    if (await handleCollectingJobState(normalizedFrom, name, text, state)) {
      return;
    }

    if (await handleConfirmingJobState(normalizedFrom, text, state)) {
      return;
    }

    if (await handleTechYesFlow(normalizedFrom, text)) {
      return;
    }

    await handleDefaultReply(normalizedFrom);
  } catch (error) {
    console.error('[jobBot] Failed to handle message', {
      from: normalizedFrom,
      messageId,
      error,
    });

    try {
      await sendWhatsAppText(
        normalizedFrom,
        'Sorry, I hit an error processing your message. Please try again.',
      );
    } catch (replyError) {
      console.error('[jobBot] Failed to send error reply', {
        from: normalizedFrom,
        messageId,
        replyError,
      });
    }
  }
}
