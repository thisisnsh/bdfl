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
      prompt: 'Last Prompt: Plan the GitHub Pages launch.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Planning agent · Codex · gpt-5.6-sol · high effort</p>
          <p class="demo-heading">Codex</p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-dim">›</span> Add a single-page GitHub Pages site for BDFL. Keep it dark and use the logo geometry.</div>
            <div class="demo-line term-dim">• Reading README.md and repository guidance</div>
            <div class="demo-line term-dim">• Inspecting the terminal renderer and current feature set</div>
            <div class="term-card">
              <p class="term-white">I have enough context to draft the implementation plan.</p>
              <p class="term-dim">The planner stays read-only. No files change until you approve the plan.</p>
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
              <p class="term-white">BDFL separates durable intent from execution.</p>
              <p class="term-dim">Plans are immutable, workers receive scoped worktrees, and integration waits for fresh verification.</p>
            </div>
            <div class="demo-line"><span class="term-cyan">❯</span> Ready to turn this into a versioned plan.<span class="term-cursor"></span></div>
          </div>
        </div>`
    },
    'ollama-one': {
      prompt: 'Last Prompt: Build the responsive page shell.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Worker agent · Ollama · qwen3-coder:30b · high effort</p>
          <p class="demo-heading">Worker 1 / page-shell</p>
          <div class="demo-lines">
            <div class="demo-line term-dim">Worktree  .bdfl/worktrees/launch-site/page-shell</div>
            <div class="demo-line"><span class="term-green">✓</span> Created semantic page structure</div>
            <div class="demo-line"><span class="term-green">✓</span> Added responsive dark theme</div>
            <div class="demo-line"><span class="term-green">✓</span> Preserved repository-owned screenshots</div>
            <div class="demo-line term-yellow">◐ Running local checks</div>
            <div class="term-progress"><span></span></div>
            <div class="demo-line term-dim">npm run validate · 18 passing</div>
          </div>
        </div>`
    },
    'ollama-two': {
      prompt: 'Last Prompt: Make the terminal demo interactive.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Worker agent · Ollama · gpt-oss:120b-cloud · high effort</p>
          <p class="demo-heading">Worker 2 / terminal-demo <span class="term-yellow">*</span></p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-green">✓</span> Recreated the BDFL action rail</div>
            <div class="demo-line"><span class="term-green">✓</span> Added clickable planning and worker sessions</div>
            <div class="term-card">
              <p class="term-yellow">Worker needs your attention</p>
              <p class="term-dim">Should the demo open on the Codex planner or the Sessions screen?</p>
            </div>
            <div class="demo-line"><span class="term-cyan">›</span> Reply to the worker<span class="term-cursor"></span></div>
          </div>
        </div>`
    },
    'ollama-three': {
      prompt: 'Last Prompt: Add SEO and browser metadata.',
      html: `
        <div class="demo-pane">
          <p class="demo-kicker">Worker agent · Ollama · qwen3-coder:30b · medium effort</p>
          <p class="demo-heading">Worker 3 / metadata <span class="term-green">accepted</span></p>
          <div class="demo-lines">
            <div class="demo-line"><span class="term-green">✓</span> Canonical and search metadata</div>
            <div class="demo-line"><span class="term-green">✓</span> Open Graph preview using bdfl.png</div>
            <div class="demo-line"><span class="term-green">✓</span> Browser, Safari, and Apple icons</div>
            <div class="demo-line"><span class="term-green">✓</span> Structured SoftwareApplication data</div>
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
          <p class="demo-heading">Choose the agents and defaults BDFL should restore with this session.</p>
          <div class="term-options">
            <div class="term-option done">1. Delegator agent <span class="term-white">Codex</span></div>
            <div class="term-option done">2. Delegator model <span class="term-white">gpt-5.6-sol · High</span></div>
            <div class="term-option done">3. Delegator agent options <span class="term-white">No extra options</span></div>
            <div class="term-option done">4. Worker agent <span class="term-white">Ollama</span></div>
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
            <div class="demo-row selected"><span class="row-status">Running</span><strong>Codex 1</strong><small>bdfl · Updated just now</small><div class="term-tree">├─ Planning agent · Codex &nbsp; <span class="term-green">Running</span><br>├─ W 1 · Ollama &nbsp; <span class="term-green">Running</span><br>└─ W 2* · Ollama &nbsp; <span class="term-yellow">Needs attention</span></div></div>
            <div class="demo-row"><span class="row-status">Running</span><strong>Claude Code 1</strong><small>bdfl · Updated 2 minutes ago</small><div class="term-tree">├─ Planning agent · Claude Code &nbsp; <span class="term-green">Running</span><br>└─ W 3✓ · Ollama &nbsp; <span class="term-green">Accepted</span></div></div>
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
            <div class="demo-row selected"><span class="row-status">Latest v3</span><strong>Launch the BDFL website</strong><small>8 approval sections · 3 implementation workers + 1 verifier</small><div class="term-tree"><span class="term-green">✓</span> Shared decisions<br>├─ <span class="term-green">✓</span> page-shell<br>├─ <span class="term-green">✓</span> terminal-demo<br>├─ <span class="term-green">✓</span> metadata<br>└─ <span class="term-green">✓</span> Global validation</div></div>
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
            <div class="demo-row selected"><span class="row-status waiting">Needs review</span><strong>Codex 1 (W 1) · Launch the BDFL website</strong><small>3 changed paths · all local checks passed</small></div>
          </div>
          <div class="term-diff"><span class="term-dim">@@ index.html</span><span class="add">+ &lt;section id="workflow"&gt;</span><span class="add">+ &nbsp; Plan → Approve → Build → Verify</span><span class="remove">- &lt;img src="terminal.png"&gt;</span><span class="add">+ &lt;div class="interactive-terminal"&gt;</span></div>
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
