(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#site-nav');

  menuButton?.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    navigation.classList.toggle('open', !isOpen);
  });

  navigation?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menuButton?.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('open');
    });
  });

  const copyButton = document.querySelector('[data-copy]');
  copyButton?.addEventListener('click', async () => {
    const label = copyButton.querySelector('span');
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
      label.textContent = 'Copied';
      window.setTimeout(() => { label.textContent = 'Copy'; }, 1800);
    } catch {
      label.textContent = 'Select';
    }
  });

  const demoContent = document.querySelector('#demo-content');
  const demoPrompt = document.querySelector('#demo-prompt');
  const demoViews = {
    codex: {
      prompt: 'Last Prompt: Plan the requested repository change.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Planning agent · Codex · gpt-5.6-sol · high effort</p>
          <p class="demo-heading">Codex</p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-dim">›</span> Inspect this Git repository and create a deliberate implementation plan. Do not edit files.</div>
            <div class="demo-line term-dim">• Reading repository guidance and project documentation</div>
            <div class="demo-line term-dim">• Mapping owned paths, dependencies, locks, and validation</div>
            <div class="term-card">
              <p class="term-white">I have enough context to submit the first plan version.</p>
              <p class="term-dim">The planning agent stays read-only. Execution remains blocked until every section is approved.</p>
            </div>
            <div class="demo-line"><span class="term-cyan">›</span> Describe any constraints before I submit v1<span class="term-cursor"></span></div>
          </div>
        </div>`
    },
    claude: {
      prompt: 'Last Prompt: Review the architecture before planning.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Planning agent · Claude Code · Opus 4.6 · high effort</p>
          <p class="demo-heading">Claude Code</p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-dim">❯</span> Review how plans, workers, and integration are separated.</div>
            <div class="demo-line term-dim">⏺ Read src/tui/supervisor.js</div>
            <div class="demo-line term-dim">⏺ Read src/workers/scheduler.js</div>
            <div class="term-card">
              <p class="term-white">BDFL separates deliberate planning from isolated execution.</p>
              <p class="term-dim">Plans are immutable, workers receive focused worktrees, and integration waits for global checks and fresh verification.</p>
            </div>
            <div class="demo-line"><span class="term-cyan">❯</span> Ready to turn this into a versioned plan.<span class="term-cursor"></span></div>
          </div>
        </div>`
    },
    'ollama-one': {
      prompt: 'Last Prompt: Implement the approved worker chunk.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Worker agent · Ollama via Codex · gpt-oss:120b-cloud · high effort</p>
          <p class="demo-heading">Worker 1 / implementation</p>
          <div class="demo-lines">
            <div class="demo-line term-dim">Worktree  .bdfl/worktrees/execution/implementation</div>
            <div class="demo-line"><span class="term-green">✓</span> Changed only the owned paths</div>
            <div class="demo-line"><span class="term-green">✓</span> Preserved shared decisions and named locks</div>
            <div class="demo-line"><span class="term-green">✓</span> Recorded the diff and commit metadata</div>
            <div class="demo-line term-yellow">◐ Running local checks</div>
            <div class="term-progress"><span></span></div>
            <div class="demo-line term-dim">npm run validate · 18 passing</div>
          </div>
        </div>`
    },
    'ollama-two': {
      prompt: 'Last Prompt: Implement the dependent worker chunk.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Worker agent · Ollama via Codex · gpt-oss:120b-cloud · high effort</p>
          <p class="demo-heading">Worker 2 / dependent-change <span class="term-yellow">*</span></p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-green">✓</span> Waited for the prerequisite chunk</div>
            <div class="demo-line"><span class="term-green">✓</span> Completed the isolated implementation</div>
            <div class="term-card">
              <p class="term-yellow">Worker needs your attention</p>
              <p class="term-dim">A project decision is needed before the worker can finish this chunk.</p>
            </div>
            <div class="demo-line"><span class="term-cyan">›</span> Reply to the worker<span class="term-cursor"></span></div>
          </div>
        </div>`
    },
    'ollama-three': {
      prompt: 'Last Prompt: Complete the approved validation chunk.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Worker agent · Ollama via Codex · gpt-oss:120b-cloud · medium effort</p>
          <p class="demo-heading">Worker 3 / validation <span class="term-green">accepted</span></p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-green">✓</span> Worker checks passed</div>
            <div class="demo-line"><span class="term-green">✓</span> Changed paths stayed in scope</div>
            <div class="demo-line"><span class="term-green">✓</span> Summary and diff recorded</div>
            <div class="demo-line"><span class="term-green">✓</span> Result accepted after review</div>
            <div class="term-card">
              <p class="term-white">Result accepted</p>
              <p class="term-dim">Commit 8d1c4ef · 4 changed paths · checks passed</p>
            </div>
          </div>
        </div>`
    },
    new: {
      prompt: 'New session setup',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">New session</p>
          <p class="demo-heading">Choose separate planning and worker agents, models, effort levels, options, and worker capacity.</p>
          <div class="term-options">
            <div class="term-option done">1. Planning agent <span class="term-white">Codex</span></div>
            <div class="term-option done">2. Planning model <span class="term-white">gpt-5.6-sol · High</span></div>
            <div class="term-option done">3. Planning agent options <span class="term-white">No extra options</span></div>
            <div class="term-option done">4. Worker agent <span class="term-white">Ollama via Codex</span></div>
            <div class="term-option done">5. Worker model <span class="term-white">gpt-oss:120b-cloud · High</span></div>
            <div class="term-option pending">6. Max worker count <span class="term-white">3</span></div>
            <div class="term-option selected">› Create session</div>
          </div>
        </div>`
    },
    sessions: {
      prompt: 'Open or resume a saved session.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Your sessions</p>
          <p class="demo-muted">Open a running session or resume one you closed earlier.</p>
          <div class="session-list">
            <div class="demo-row selected"><span class="row-status">Running</span><strong>Codex 1</strong><small>bdfl · Updated just now</small><div class="term-tree">├─ Planning agent · Codex &nbsp; <span class="term-green">Running</span><br>├─ W 1 · Ollama via Codex &nbsp; <span class="term-green">Running</span><br>└─ W 2* · Ollama via Codex &nbsp; <span class="term-yellow">Needs attention</span></div></div>
            <div class="demo-row"><span class="row-status">Running</span><strong>Claude Code 1</strong><small>bdfl · Updated 2 minutes ago</small><div class="term-tree">├─ Planning agent · Claude Code &nbsp; <span class="term-green">Running</span><br>└─ W 3✓ · Ollama via Codex &nbsp; <span class="term-green">Accepted</span></div></div>
          </div>
        </div>`
    },
    plans: {
      prompt: 'Plan v3 is fully approved and ready.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Plans</p>
          <p class="demo-muted">Browse durable implementation plans created in this workspace.</p>
          <div class="plan-list">
            <div class="demo-row selected"><span class="row-status">Latest v3</span><strong>Implement the approved repository change</strong><small>5 approval sections · 3 implementation workers + 1 verifier</small><div class="term-tree"><span class="term-green">✓</span> Shared decisions<br>├─ <span class="term-green">✓</span> implementation<br>├─ <span class="term-green">✓</span> dependent-change<br>├─ <span class="term-green">✓</span> validation<br>└─ <span class="term-green">✓</span> Global validation</div></div>
            <div class="demo-row"><span class="row-status">Latest v1</span><strong>Document model providers</strong><small>5 approval sections · Updated yesterday</small></div>
          </div>
        </div>`
    },
    review: {
      prompt: 'Review each result before integration.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Ready for review</p>
          <p class="demo-muted">Inspect the worker result, checks, and actual diff before accepting it.</p>
          <div class="review-list">
            <div class="demo-row selected"><span class="row-status waiting">Needs review</span><strong>Codex 1 (W 1) · Approved repository change</strong><small>3 changed paths · all local checks passed</small></div>
          </div>
          <div class="term-diff"><span class="term-dim">@@ approved worker result</span><span class="add">+ role-specific MCP tools</span><span class="add">+ isolated worker worktrees</span><span class="remove">- integrate before verification</span><span class="add">+ fresh verification before integration</span></div>
          <div class="demo-line term-cyan">a accept &nbsp; • &nbsp; f feedback &nbsp; • &nbsp; Esc back</div>
        </div>`
    }
  };

  const renderDemo = (key, sourceButton) => {
    const view = demoViews[key];
    if (!demoContent || !view) return;
    document.querySelectorAll('.demo-actions button, .demo-rail button').forEach((button) => button.classList.remove('active'));
    sourceButton?.classList.add('active');
    demoContent.classList.add('swap');
    window.setTimeout(() => {
      demoContent.innerHTML = view.html;
      demoPrompt.textContent = view.prompt;
      demoContent.classList.remove('swap');
    }, 90);
  };

  document.querySelectorAll('[data-demo-view]').forEach((button) => {
    button.addEventListener('click', () => renderDemo(button.dataset.demoView, button));
  });
  document.querySelectorAll('[data-demo-agent]').forEach((button) => {
    button.addEventListener('click', () => renderDemo(button.dataset.demoAgent, button));
  });
  if (demoContent) renderDemo('codex', document.querySelector('[data-demo-agent="codex"]'));

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('visible'));
  }
})();
