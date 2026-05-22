import { getTurnstileToken, solvePow } from '@akedly/shield';
import './styles.css';

type OtpPurpose = 'registration' | 'password_reset';

type ChallengePayload = {
  challenge?: string;
  difficulty?: number;
  challengeToken?: string;
  challengeRequired?: boolean;
  turnstile?: {
    required?: boolean;
    siteKey?: string;
  };
};

type ChallengeResponse = {
  status?: string;
  message?: string;
  data?: ChallengePayload;
};

type ApiEnvelope<T> = {
  success?: boolean;
  statusCode?: number;
  data?: T;
  error?: {
    message?: string;
  };
};

type PowSolution = {
  challengeToken: string;
  nonce: string;
};

type LogEntry = {
  at: string;
  step: string;
  method: string;
  path: string;
  payload?: unknown;
  status?: number;
  response?: unknown;
  error?: string;
};

type ShieldSession = {
  challenge?: ChallengePayload;
  powSolution?: PowSolution;
  turnstileToken?: string;
};

type RegistrationForm = {
  name: string;
  ssn: string;
  phone: string;
  password: string;
  otp: string;
  transactionReqID: string;
};

type ResetForm = {
  phone: string;
  otp: string;
  transactionReqID: string;
  newPassword: string;
  confirmPassword: string;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'http://localhost:3000';
const MAX_LOG_ENTRIES = 20;

let activeTab: 'registration' | 'reset' = 'registration';
let regPrepared = false;
let resetPrepared = false;
let busy = false;

let regForm: RegistrationForm = {
  name: 'Test User',
  ssn: '12345678',
  phone: '+201000000001',
  password: 'Secret123',
  otp: '',
  transactionReqID: '',
};

let resetForm: ResetForm = {
  phone: '+201000000001',
  otp: '',
  transactionReqID: '',
  newPassword: 'NewSecret123',
  confirmPassword: 'NewSecret123',
};

let shieldSession: ShieldSession = {};
let logs: LogEntry[] = [];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

function isE164(input: string): boolean {
  return /^\+?[1-9]\d{7,15}$/.test(input.trim());
}

function addLog(entry: Omit<LogEntry, 'at'>): void {
  logs = [{ at: new Date().toISOString(), ...entry }, ...logs].slice(0, MAX_LOG_ENTRIES);
}

function clearShieldSession(): void {
  shieldSession = {};
}

async function apiRequest<T>(step: string, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<{ status: number; body: T }> {
  const url = `${API_BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    });

    const raw = await response.text();
    let body: unknown = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = { raw };
    }

    addLog({ step, method, path, payload, status: response.status, response: body });
    return { status: response.status, body: body as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addLog({ step, method, path, payload, error: message });
    throw error;
  }
}

async function prepareRegistration(): Promise<void> {
  if (!isE164(regForm.phone)) throw new Error('Registration phone must be E.164-like');
  busy = true;
  render();
  try {
    const payload = {
      name: regForm.name,
      ssn: regForm.ssn,
      phone: regForm.phone,
      password: regForm.password,
    };
    const { status } = await apiRequest('registration.prepare', 'POST', '/auth/register', payload);
    regPrepared = status >= 200 && status < 300;
  } finally {
    busy = false;
    render();
  }
}

async function prepareReset(): Promise<void> {
  if (!isE164(resetForm.phone)) throw new Error('Reset phone must be E.164-like');
  busy = true;
  render();
  try {
    const { status } = await apiRequest('reset.prepare', 'POST', '/auth/password/request-otp', { phone: resetForm.phone });
    resetPrepared = status >= 200 && status < 300;
  } finally {
    busy = false;
    render();
  }
}

async function startShieldSession(purpose: OtpPurpose): Promise<void> {
  const prepared = purpose === 'registration' ? regPrepared : resetPrepared;
  if (!prepared) {
    throw new Error(`Run ${purpose === 'registration' ? 'registration' : 'password reset'} prepare first`);
  }

  const phone = purpose === 'registration' ? regForm.phone : resetForm.phone;
  if (!isE164(phone)) throw new Error('Phone must be E.164-like before challenge');

  busy = true;
  render();
  try {
    const { status, body } = await apiRequest<ApiEnvelope<ChallengeResponse>>('shield.challenge', 'GET', '/auth/akedly/challenge');
    if (status < 200 || status >= 300) {
      const errorMessage = body?.error?.message || 'Failed to fetch Akedly challenge';
      throw new Error(errorMessage);
    }
    // Backend returns an envelope: { success, data: { status, data: <challenge> } }.
    const challengeData = body?.data?.data ?? {};

    let nonce = '0';
    if (challengeData.challengeRequired && challengeData.challenge && typeof challengeData.difficulty === 'number') {
      const solved = await solvePow(challengeData.challenge, challengeData.difficulty);
      nonce = String((solved as { nonce: number | string }).nonce);
    }

    let turnstileToken = '';
    if (challengeData.turnstile?.required && challengeData.turnstile.siteKey) {
      turnstileToken = await getTurnstileToken(challengeData.turnstile.siteKey);
    }

    shieldSession = {
      challenge: challengeData,
      powSolution: {
        challengeToken: challengeData.challengeToken ?? '',
        nonce,
      },
      turnstileToken,
    };

    addLog({
      step: 'shield.solved',
      method: 'CLIENT',
      path: `/shield/${purpose}`,
      response: {
        challengeRequired: challengeData.challengeRequired,
        turnstileRequired: challengeData.turnstile?.required,
        nonce,
        hasTurnstileToken: Boolean(turnstileToken),
      },
    });
  } finally {
    busy = false;
    render();
  }
}

async function sendOtp(purpose: OtpPurpose): Promise<void> {
  const phoneNumber = purpose === 'registration' ? regForm.phone : resetForm.phone;
  const prepared = purpose === 'registration' ? regPrepared : resetPrepared;

  if (!prepared) throw new Error('Run the prerequisite prepare call first');
  if (!shieldSession.powSolution?.challengeToken) throw new Error('Start Shield session first');

  busy = true;
  render();
  try {
    await apiRequest('akedly.send', 'POST', '/auth/akedly/send', {
      phoneNumber,
      purpose,
      powSolution: shieldSession.powSolution,
      turnstileToken: shieldSession.turnstileToken || undefined,
    });
  } finally {
    busy = false;
    render();
  }
}

async function verifyRegistration(): Promise<void> {
  if (!isE164(regForm.phone)) throw new Error('Registration phone must be E.164-like');
  if (!regForm.otp.trim()) throw new Error('Registration OTP is required');

  busy = true;
  render();
  try {
    await apiRequest('registration.verify', 'POST', '/auth/register/verify', {
      phone: regForm.phone,
      otp: regForm.otp,
      transactionReqID: regForm.transactionReqID.trim() || undefined,
    });
  } finally {
    busy = false;
    render();
  }
}

async function verifyReset(): Promise<void> {
  if (!isE164(resetForm.phone)) throw new Error('Reset phone must be E.164-like');
  if (!resetForm.otp.trim()) throw new Error('Reset OTP is required');
  if (resetForm.newPassword !== resetForm.confirmPassword) {
    throw new Error('Reset password confirmation must match');
  }

  busy = true;
  render();
  try {
    await apiRequest('reset.verify', 'POST', '/auth/password/reset', {
      phone: resetForm.phone,
      otp: resetForm.otp,
      transactionReqID: resetForm.transactionReqID.trim() || undefined,
      newPassword: resetForm.newPassword,
      confirmPassword: resetForm.confirmPassword,
    });
  } finally {
    busy = false;
    render();
  }
}

function registrationTab(): string {
  return `
    <section class="panel">
      <h2>Registration OTP</h2>
      <div class="grid">
        <label>Name<input id="reg-name" value="${regForm.name}" /></label>
        <label>SSN<input id="reg-ssn" value="${regForm.ssn}" /></label>
        <label>Phone<input id="reg-phone" value="${regForm.phone}" /></label>
        <label>Password<input id="reg-password" type="password" value="${regForm.password}" /></label>
      </div>
      <div class="actions">
        <button id="reg-prepare" ${busy ? 'disabled' : ''}>1) Prepare Registration</button>
        <button id="reg-shield" ${(busy || !regPrepared) ? 'disabled' : ''}>2) Get + Solve Shield</button>
        <button id="reg-send" ${(busy || !regPrepared || !shieldSession.powSolution?.challengeToken) ? 'disabled' : ''}>3) Send OTP</button>
      </div>
      <div class="grid">
        <label>OTP<input id="reg-otp" value="${regForm.otp}" /></label>
        <label>transactionReqID (optional)<input id="reg-tx" value="${regForm.transactionReqID}" /></label>
      </div>
      <div class="actions">
        <button id="reg-verify" ${(busy || !regPrepared) ? 'disabled' : ''}>4) Verify Registration</button>
      </div>
      <p class="status">Prepared: <strong>${regPrepared ? 'yes' : 'no'}</strong></p>
    </section>
  `;
}

function resetTab(): string {
  const mismatch = resetForm.newPassword !== resetForm.confirmPassword;
  return `
    <section class="panel">
      <h2>Password Reset OTP</h2>
      <div class="grid">
        <label>Phone<input id="reset-phone" value="${resetForm.phone}" /></label>
        <label>OTP<input id="reset-otp" value="${resetForm.otp}" /></label>
        <label>transactionReqID (optional)<input id="reset-tx" value="${resetForm.transactionReqID}" /></label>
        <label>New Password<input id="reset-new-password" type="password" value="${resetForm.newPassword}" /></label>
        <label>Confirm Password<input id="reset-confirm-password" type="password" value="${resetForm.confirmPassword}" /></label>
      </div>
      <div class="actions">
        <button id="reset-prepare" ${busy ? 'disabled' : ''}>1) Prepare Reset</button>
        <button id="reset-shield" ${(busy || !resetPrepared) ? 'disabled' : ''}>2) Get + Solve Shield</button>
        <button id="reset-send" ${(busy || !resetPrepared || !shieldSession.powSolution?.challengeToken) ? 'disabled' : ''}>3) Send OTP</button>
      </div>
      <div class="actions">
        <button id="reset-verify" ${(busy || !resetPrepared || mismatch) ? 'disabled' : ''}>4) Verify Reset</button>
      </div>
      <p class="status">Prepared: <strong>${resetPrepared ? 'yes' : 'no'}</strong>${mismatch ? ' • Passwords mismatch' : ''}</p>
    </section>
  `;
}

function shieldPanel(): string {
  return `
    <section class="panel">
      <h2>Shield Session</h2>
      <p>Challenge token: <code>${shieldSession.powSolution?.challengeToken ?? '-'}</code></p>
      <p>Nonce: <code>${shieldSession.powSolution?.nonce ?? '-'}</code></p>
      <p>Turnstile token: <code>${shieldSession.turnstileToken ? 'present' : 'not required / missing'}</code></p>
      <button id="shield-clear" ${busy ? 'disabled' : ''}>Clear Shield Session</button>
    </section>
  `;
}

function logsPanel(): string {
  const lines = logs
    .map((entry) => JSON.stringify(entry, null, 2))
    .join('\n\n');

  return `
    <section class="panel logs">
      <h2>API Console (last ${MAX_LOG_ENTRIES})</h2>
      <button id="logs-clear" ${busy ? 'disabled' : ''}>Clear Logs</button>
      <pre>${lines || 'No calls yet.'}</pre>
    </section>
  `;
}

function render(): void {
  app.innerHTML = `
    <main>
      <header>
        <h1>Akedly Integration Test Client</h1>
        <p>API Base URL: <code>${API_BASE_URL}</code></p>
      </header>

      <nav class="tabs">
        <button id="tab-registration" class="${activeTab === 'registration' ? 'active' : ''}" ${busy ? 'disabled' : ''}>Registration OTP</button>
        <button id="tab-reset" class="${activeTab === 'reset' ? 'active' : ''}" ${busy ? 'disabled' : ''}>Password Reset OTP</button>
      </nav>

      ${shieldPanel()}
      ${activeTab === 'registration' ? registrationTab() : resetTab()}
      ${logsPanel()}
    </main>
  `;

  wireEvents();
}

function wireEvents(): void {
  document.querySelector<HTMLButtonElement>('#tab-registration')?.addEventListener('click', () => {
    activeTab = 'registration';
    render();
  });

  document.querySelector<HTMLButtonElement>('#tab-reset')?.addEventListener('click', () => {
    activeTab = 'reset';
    render();
  });

  document.querySelector<HTMLButtonElement>('#shield-clear')?.addEventListener('click', () => {
    clearShieldSession();
    render();
  });

  document.querySelector<HTMLButtonElement>('#logs-clear')?.addEventListener('click', () => {
    logs = [];
    render();
  });

  document.querySelector<HTMLInputElement>('#reg-name')?.addEventListener('input', (e) => {
    regForm.name = (e.target as HTMLInputElement).value;
    regPrepared = false;
    clearShieldSession();
    render();
  });
  document.querySelector<HTMLInputElement>('#reg-ssn')?.addEventListener('input', (e) => {
    regForm.ssn = (e.target as HTMLInputElement).value;
    regPrepared = false;
    clearShieldSession();
    render();
  });
  document.querySelector<HTMLInputElement>('#reg-phone')?.addEventListener('input', (e) => {
    const next = (e.target as HTMLInputElement).value;
    if (next !== regForm.phone) {
      regForm.phone = next;
      regPrepared = false;
      clearShieldSession();
      render();
    }
  });
  document.querySelector<HTMLInputElement>('#reg-password')?.addEventListener('input', (e) => {
    regForm.password = (e.target as HTMLInputElement).value;
    regPrepared = false;
    clearShieldSession();
    render();
  });
  document.querySelector<HTMLInputElement>('#reg-otp')?.addEventListener('input', (e) => {
    regForm.otp = (e.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>('#reg-tx')?.addEventListener('input', (e) => {
    regForm.transactionReqID = (e.target as HTMLInputElement).value;
  });

  document.querySelector<HTMLInputElement>('#reset-phone')?.addEventListener('input', (e) => {
    const next = (e.target as HTMLInputElement).value;
    if (next !== resetForm.phone) {
      resetForm.phone = next;
      resetPrepared = false;
      clearShieldSession();
      render();
    }
  });
  document.querySelector<HTMLInputElement>('#reset-otp')?.addEventListener('input', (e) => {
    resetForm.otp = (e.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>('#reset-tx')?.addEventListener('input', (e) => {
    resetForm.transactionReqID = (e.target as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>('#reset-new-password')?.addEventListener('input', (e) => {
    resetForm.newPassword = (e.target as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLInputElement>('#reset-confirm-password')?.addEventListener('input', (e) => {
    resetForm.confirmPassword = (e.target as HTMLInputElement).value;
    render();
  });

  document.querySelector<HTMLButtonElement>('#reg-prepare')?.addEventListener('click', () => {
    prepareRegistration().catch((error) => {
      addLog({ step: 'registration.prepare', method: 'POST', path: '/auth/register', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reg-shield')?.addEventListener('click', () => {
    startShieldSession('registration').catch((error) => {
      addLog({ step: 'shield.challenge', method: 'CLIENT', path: '/auth/akedly/challenge', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reg-send')?.addEventListener('click', () => {
    sendOtp('registration').catch((error) => {
      addLog({ step: 'akedly.send', method: 'POST', path: '/auth/akedly/send', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reg-verify')?.addEventListener('click', () => {
    verifyRegistration().catch((error) => {
      addLog({ step: 'registration.verify', method: 'POST', path: '/auth/register/verify', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reset-prepare')?.addEventListener('click', () => {
    prepareReset().catch((error) => {
      addLog({ step: 'reset.prepare', method: 'POST', path: '/auth/password/request-otp', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reset-shield')?.addEventListener('click', () => {
    startShieldSession('password_reset').catch((error) => {
      addLog({ step: 'shield.challenge', method: 'CLIENT', path: '/auth/akedly/challenge', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reset-send')?.addEventListener('click', () => {
    sendOtp('password_reset').catch((error) => {
      addLog({ step: 'akedly.send', method: 'POST', path: '/auth/akedly/send', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#reset-verify')?.addEventListener('click', () => {
    verifyReset().catch((error) => {
      addLog({ step: 'reset.verify', method: 'POST', path: '/auth/password/reset', error: error instanceof Error ? error.message : String(error) });
      render();
    });
  });
}

render();
