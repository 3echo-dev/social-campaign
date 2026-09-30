// Who a person sees working, and what each one is doing.
//
// This lived inside stage.js, where only a workflow row calling that script could reach it.
// A state change knows the plan too, and the plan names an agent on every row, so the pane
// can show the workers on every stage of every route without a run remembering to say so.

// What a person reads instead of an agent name or a workstream id. The eight production roles are the
// agents under agents/; the rest are the research workstreams, which are spawns of one agent
// but separate workers as far as anybody watching is concerned.
const ROLES = {
  producer: { label: 'Social media manager', action: 'Keeping the work moving and checking each piece as it lands.' },
  researcher: { label: 'Researcher', action: 'Gathering evidence and citing where each fact came from.' },
  strategist: { label: 'Strategist', action: 'Turning the research into one clear direction.' },
  copywriter: { label: 'Copywriter', action: 'Writing the post copy and the call to action.' },
  scriptwriter: { label: 'Scriptwriter', action: 'Writing the script and the storyboard.' },
  'media-buyer': { label: 'Media buyer', action: 'Planning where the budget goes and how it is measured.' },
  videographer: { label: 'Videographer', action: 'Checking the video against the approved storyboard.' },
  editor: { label: 'Editor', action: 'Checking facts, brand fit, policy and platform rules.' },

  audience: { label: 'Audience researcher', action: 'Studying the audience and the words they use.' },
  competitors: { label: 'Competitor researcher', action: 'Reviewing competitor messages, formats and offers.' },
  'product-evidence': { label: 'Product researcher', action: 'Checking the evidence behind every product claim.' },
  customer: { label: 'Customer researcher', action: 'Finding the common questions, concerns and objections.' },
  'watch-video': { label: 'Video interpretation', action: 'Watching the video and breaking down what it does.' },
  brand: { label: 'Brand researcher', action: 'Reading the brand voice, audience and positioning files.' },

  // Pricing is a worker like any other. Without it the pane showed nothing at all while the
  // quote was being worked out, and the person was left looking at a stale "your turn".
  estimator: { label: 'Cost estimator', action: 'Working out what the images and video will cost.' },
  'image-maker': { label: 'Image maker', action: 'Making the pictures for each panel.' },
  'video-maker': { label: 'Video maker', action: 'Turning the approved panels into clips.' },
};

// The spellings a workflow row or a spawn prompt is likely to use for the same worker.
const ALIASES = {
  manager: 'producer', 'social-media-manager': 'producer',
  research: 'researcher', market: 'audience', 'market-research': 'audience',
  competitor: 'competitors', product: 'product-evidence', evidence: 'product-evidence',
  customers: 'customer', questions: 'customer',
  video: 'watch-video', 'analyze-video': 'watch-video', 'video-analysis': 'watch-video',
  'video-analyzer': 'watch-video', 'video-analyst': 'watch-video',
  'brand-research': 'brand', 'brand-researcher': 'brand',
  estimate: 'estimator', quote: 'estimator', pricing: 'estimator', cost: 'estimator',
  images: 'image-maker', 'make-image': 'image-maker',
  clips: 'video-maker', 'make-video': 'video-maker',
  writer: 'copywriter', script: 'scriptwriter', buyer: 'media-buyer', qa: 'editor',
};

// The pane has three words for a worker; a workflow row has more.
const STATUSES = {
  running: 'working', working: 'working', started: 'working', start: 'working',
  done: 'done', finished: 'done', complete: 'done', verified: 'done',
  waiting: 'waiting', blocked: 'waiting',
};

const roleOf = (name) => {
  const key = String(name || '').trim().toLowerCase();
  const id = ROLES[key] ? key : ALIASES[key];
  return id ? { id, ...ROLES[id] } : null;
};

// "audience:running,competitors:running,product-evidence:done" into what the app stores.
// An unknown name is still a worker: it goes through as title case rather than being
// dropped, because a silent worker is the very thing this script exists to fix.
function parseAgents(text) {
  if (!text) return [];
  return String(text).split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const at = entry.lastIndexOf(':');
    const name = (at >= 0 ? entry.slice(0, at) : entry).trim();
    const said = (at >= 0 ? entry.slice(at + 1) : 'running').trim().toLowerCase();
    const known = roleOf(name);
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const words = slug.split('-').filter(Boolean).join(' ');
    return {
      id: (known ? known.id : slug || 'worker').slice(0, 80),
      role: (known ? known.label : (words ? words[0].toUpperCase() + words.slice(1) : 'Worker')).slice(0, 80),
      action: (known ? known.action : 'Working on this part of the job.').slice(0, 180),
      status: STATUSES[said] || 'working',
    };
  // The app keeps eight; more than that stops being readable in a pane anyway.
  }).slice(0, 8);
}


// Names that appear in a plan's Agent column but are not a person anybody watches.
// The workstreams one research row fans out into, each its own worker in the pane.
const WORKSTREAMS = ['audience', 'competitors', 'product-evidence', 'customer', 'brand'];

// Skills that mean a distinct worker a person can see, beyond whoever owns the row. The
// The videographer watching a reference video is a distinct visible worker, even though the
// source skill keeps its historical watch-video name.
const SKILL_WORKERS = { 'watch-video': 'watch-video', 'analyze-video': 'watch-video' };

const NOT_A_WORKER = new Set(['scripts', 'script', 'human', 'analyst', 'performance', '-', '', 'none']);

/**
 * Who is working on a stage, read from the job's own plan.
 *
 * The pane showed workers only where a workflow row remembered to name them, so most stages
 * of most routes showed nobody at all. Every row already names its agent, and the research
 * row names its workstreams in the task itself, so the plan can answer this for every stage
 * of every route without anyone remembering.
 *
 * A row with no state of its own belongs to the next row that has one, which is how a plan
 * reads: several rows of work, then the state they earn together.
 */
function planWorkflowId(planText) {
  const said = /\*\*Workflow:\*\*\s*`?([a-z0-9][a-z0-9_-]*)/i.exec(String(planText || ''));
  return said ? said[1] : null;
}

function workersFromPlan(planText, stageId, status, makes, workflowId = planWorkflowId(planText)) {
  const stages = require('./lib-stages.js');
  const lines = String(planText || '').split(/\r?\n/).filter(l => l.trim().startsWith('|'));
  const cells = l => l.split('|').slice(1, -1).map(c => c.trim());
  const header = lines.find(l => cells(l).includes('State after'));
  if (!header) return [];
  const head = cells(header);
  const at = {
    agent: head.indexOf('Agent'), task: head.indexOf('Task'),
    skills: head.indexOf('Skills'), state: head.indexOf('State after'),
  };
  if (at.state < 0) return [];

  const rows = [];
  for (const line of lines) {
    const c = cells(line);
    if (c.includes('State after') || c.every(x => /^:?-+:?$/.test(x))) continue;
    rows.push({
      agent: (c[at.agent] || '').replace(/`/g, ''),
      task: c[at.task] || '',
      skills: c[at.skills] || '',
      state: (c[at.state] || '').replace(/`/g, ''),
    });
  }

  // Forward-fill: a row with no state of its own belongs to the next row that has one.
  for (let i = rows.length - 1, carry = ''; i >= 0; i--) {
    if (rows[i].state) carry = rows[i].state;
    else rows[i].state = carry;
  }

  // A row that ends by opening a gate did its work in the stage before it: the scriptwriter
  // writes the concepts under "Shaping the idea", and then it is your turn. Reading the row's
  // own state would list them as working on your approval, which is not a thing anyone does.
  let last = null;
  for (const row of rows) {
    const step = stages.forState(row.state, workflowId);
    row.stage = step ? step.stage : null;
    if (row.stage && stages.APPROVAL_STAGE_IDS.includes(row.stage)) row.stage = last;
    else if (row.stage) last = row.stage;
  }

  const said = [];
  for (const row of rows) {
    if (row.stage !== stageId) continue;
    if (!NOT_A_WORKER.has(row.agent.toLowerCase())) said.push(row.agent);
    // Research is the one row that fans out, and it names its workstreams in the task. Those
    // are the workers a person sees: an audience researcher and a competitor researcher, not
    // one "researcher". Only that row is read this way, because a task that merely mentions
    // the brand is not a brand researcher.
    for (const [skill, role] of Object.entries(SKILL_WORKERS)) {
      if (new RegExp('(^|[^a-z-])' + skill + '([^a-z-]|$)', 'i').test(row.skills || '')) said.push(role);
    }
    if (row.agent === 'researcher') {
      for (const name of WORKSTREAMS) {
        if (new RegExp('(^|[^a-z-])' + name + '([^a-z-]|$)', 'i').test(row.task)) said.push(name);
      }
    }
  }

  // Pricing and making are not states, they are stages the media skills report around a
  // quote, so no row's "State after" lands on them. The plan still says whether pictures or
  // clips are being made, which is enough to name who is doing it.
  // What is actually being made comes from the job, not from the workflow row, which lists
  // both skills whatever the deliverable is. A still-image job was told a video maker was
  // working on it.
  const makesImages = makes ? makes.images !== false : /make-image/.test(planText);
  const makesVideo = makes ? makes.video === true : /make-video/.test(planText);
  if (stageId === 'pricing-the-media' && (makesImages || makesVideo)) said.push('estimator');
  if (stageId === 'making-the-images-and-video') {
    if (makesImages) said.push('image-maker');
    if (makesVideo) said.push('video-maker');
  }

  const seen = new Set();
  const unique = said.filter(n => {
    const key = String(n).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parseAgents(unique.map(n => n + ':' + status).join(','));
}

module.exports = { ROLES, ALIASES, STATUSES, roleOf, parseAgents, workersFromPlan, planWorkflowId };
