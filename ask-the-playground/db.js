// The playground's database, from the page's side. Nothing downloads until
// start(): the page calls it when the playground comes into view or someone
// touches it. Postgres itself runs in db-worker.js.

export class Database extends EventTarget {
  state = { status: 'idle', progress: 0, version: '', error: '' }; // idle | loading | ready | failed
  #worker = null;
  #calls = new Map();
  #seq = 0;
  #ready = null;
  #restore = async () => {};

  /**
   * Runs whenever a fresh Postgres starts (first load, or after Stop), before
   * anything else reaches it. The page replays its changes here.
   */
  onStart(fn) {
    this.#restore = fn;
  }

  start() {
    if (this.#ready) return this.#ready;
    this.#set({ status: 'loading', progress: 0, error: '' });
    let resolve, reject;
    this.#ready = new Promise((ok, fail) => ([resolve, reject] = [ok, fail]));
    this.#ready.catch(() => {});
    const worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
    this.#worker = worker;
    worker.onmessage = async ({ data }) => {
      if (worker !== this.#worker) return;
      if (data.op === 'progress') this.#set({ progress: data.total ? data.loaded / data.total : 0 });
      else if (data.op === 'ready') {
        // Calls made meanwhile wait for #ready, so the replay goes first.
        await this.#restore({
          run: (sql, user) => this.#send('run', { sql, role: user.role, claims: user.claims }),
          admin: (sql) => this.#send('admin', { sql }),
        }).catch(() => {});
        if (worker !== this.#worker) return;
        this.#set({ status: 'ready', progress: 1, version: data.version });
        resolve();
      } else if (data.op === 'failed') this.#fail(data.message, reject);
      else if (this.#calls.has(data.id)) {
        const { ok, fail } = this.#calls.get(data.id);
        this.#calls.delete(data.id);
        data.ok ? ok(data.result) : fail(Object.assign(new Error(data.error?.message ?? 'Failed'), data.error));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (worker === this.#worker) this.#fail(event.message || 'The database stopped.', reject);
    };
    return this.#ready;
  }

  get ready() {
    return this.state.status === 'ready';
  }

  get running() {
    return this.#calls.size > 0;
  }

  run(sql, user) {
    return this.#call('run', { sql, role: user.role, claims: user.claims });
  }

  inspect(user, table) {
    return this.#call('inspect', { role: user.role, claims: user.claims, table });
  }

  /** As the owner: switching policies and row-level security. */
  admin(sql) {
    return this.#call('admin', { sql });
  }

  /** Back to the seed, in a fresh Postgres. */
  reset() {
    return this.#call('reset', {});
  }

  /** Stops a runaway query: Postgres can't be interrupted inside WebAssembly, so the worker restarts. */
  async stop() {
    const worker = this.#worker;
    if (!worker) return;
    this.#worker = null;
    this.#ready = null;
    worker.terminate();
    for (const { fail } of this.#calls.values()) fail(Object.assign(new Error('Stopped'), { stopped: true }));
    this.#calls.clear();
    await this.start();
  }

  async #call(op, args) {
    await this.start();
    return this.#send(op, args);
  }

  #send(op, args) {
    const id = ++this.#seq;
    return new Promise((ok, fail) => {
      this.#calls.set(id, { ok, fail });
      this.#worker.postMessage({ id, op, ...args });
      this.dispatchEvent(new Event('change'));
    }).finally(() => this.dispatchEvent(new Event('change')));
  }

  #fail(message, reject) {
    this.#set({ status: 'failed', error: message });
    for (const { fail } of this.#calls.values()) fail(new Error(message));
    this.#calls.clear();
    this.#worker?.terminate();
    this.#worker = null;
    this.#ready = null;
    reject?.(new Error(message));
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }
}
