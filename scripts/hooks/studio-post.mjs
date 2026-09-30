import {
  ELEVEN_LABS, THREE_ECHO, VOICE_RESULTS, VOICE_SPENDERS,
  appendEstimate, appendLinks, appendRecord, asObject, currentPriceApproval, findGenerationOwner, isLanded, isReferenceItem, isTranscriptionItem, itemKeyFor,
  jobAt, latestEstimate, mediaLinks, parseToolResponse, priceKey, quoteItem, readRecords, readSessionBinding,
  resolveJobForCall, resolveWorkspaceRoot, startMediaIfDue, toolBase, voiceOutputs, voiceRunCredits, voiceRunFinished,
} from '../../server/pipeline/facts.mjs';
import { spawnLander } from '../../server/pipeline/land-outputs.mjs';

const INPUT_LIMIT = 64 * 1024 * 1024;
const PENDING_NOTE = 'This output is finished but has no download link yet. Call get_asset for it and it is saved automatically.';
const VOICE_PENDING_NOTES = Object.freeze({
  no_link: 'This voice line is finished but has no download link yet. Check the run again and it is saved automatically once a link appears.',
  needs_sign_in: 'This voice line is finished, but its file link needs a sign-in, so it could not be saved automatically. It stays listed as waiting to be saved.',
});
const VIDEO_PRICE_FIELDS = ['duration', 'resolution', 'ratio', 'generateAudio', 'assetIds'];
const THREE_ECHO_INPUTS = ['workspaceId', 'aspectRatio', 'assetIds', 'duration', 'resolution', 'ratio', 'generateAudio'];
const VOICE_INPUTS = ['model_id', 'voice_id', 'generations_count', 'language', 'voice_description', 'text', 'connect_from', 'flow_id', 'guidance_scale', 'loudness', 'quality', 'seed', 'should_enhance'];

const finite = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

function pick(input, names) {
  const out = {};
  for (const name of names) if (input[name] !== undefined) out[name] = input[name];
  return out;
}

async function readEvent() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) return null;
  }
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
}

function tell(context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }));
}

function tagOf(job) {
  const tag = job.tag && job.tag.jobId === job.jobId ? job.tag : null;
  return { key: itemKeyFor(job), deliverable: tag?.deliverable ?? null, panel: tag?.item ?? null, version: tag?.version ?? null };
}

function boundJob(ctx) {
  const bound = readSessionBinding(ctx.root, ctx.sessionId);
  return bound ? jobAt(ctx.root, bound.brand, bound.jobId) : null;
}

function recordThreeEchoCreate(ctx) {
  const created = ctx.data.job;
  if (!created || !text(created.jobId)) return;
  const job = resolveJobForCall({ root: ctx.root, sessionId: ctx.sessionId, toolInput: ctx.input });
  if (!job) return;
  const records = readRecords(job);
  if (records.some(record => record.type === 'create' && record.providerJobId === created.jobId)) return;
  const usage = created.usage || {};
  appendRecord(job, {
    type: 'create',
    provider: THREE_ECHO,
    tool: ctx.base,
    ...tagOf(job),
    kind: text(created.kind) || (ctx.base === 'create_image_job' ? 'image' : 'video'),
    providerJobId: created.jobId,
    status: created.status ?? null,
    reservedCredits: finite(usage.reservedCostCreds),
    quotedCredits: finite(usage.quotedCostCreds),
    billingStatus: usage.billingStatus ?? null,
    prompt: text(ctx.input.prompt),
    inputs: pick(ctx.input, THREE_ECHO_INPUTS),
    inputAssetIds: Array.isArray(created.inputAssetIds) ? created.inputAssetIds : [],
    priceKey: priceKey(ctx.base, ctx.input),
    appUrl: created.appUrl ?? null,
    sessionId: ctx.sessionId ?? null,
  });
  if (!isReferenceItem(itemKeyFor(job) || '')) startMediaIfDue(job);
}

function outputIdsOf(data) {
  const job = data.job || {};
  const fromJob = (Array.isArray(job.outputAssets) ? job.outputAssets : []).map(asset => text(asset?.assetId)).filter(Boolean);
  if (fromJob.length) return fromJob;
  return (Array.isArray(data.assets) ? data.assets : []).map(asset => text(asset?.assetId)).filter(Boolean);
}

function assetSummaries(data) {
  return (Array.isArray(data.assets) ? data.assets : []).filter(asset => asset && typeof asset === 'object').map(asset => ({
    assetId: asset.assetId ?? null,
    filename: asset.filename ?? null,
    mimeType: asset.mimeType ?? null,
    sizeBytes: asset.sizeBytes ?? null,
    status: asset.status ?? null,
  }));
}

function linksFor(data, outputs, fallbackAssetId) {
  const details = new Map(assetSummaries(data).map(asset => [asset.assetId, asset]));
  return mediaLinks(data)
    .map(link => ({ ...link, assetId: link.assetId || fallbackAssetId || (outputs.length === 1 ? outputs[0] : null) }))
    .filter(link => link.assetId && outputs.includes(link.assetId))
    .map(link => ({
      ...link,
      mimeType: link.mimeType || details.get(link.assetId)?.mimeType || null,
      filename: link.filename || details.get(link.assetId)?.filename || null,
    }));
}

function land(owner, outputs, links, finalCredits) {
  if (!links.length) return;
  const provider = owner.create.provider || THREE_ECHO;
  const key = owner.create.key ?? null;
  const saved = links.map(link => pick(link, ['assetId', 'url', 'mimeType', 'filename', 'expiresAt']));
  try {
    appendLinks(owner.job, { provider, key, providerJobId: owner.providerJobId, outputs, links: saved });
  } finally {
    spawnLander({
      root: owner.job.root,
      brand: owner.job.brand,
      jobId: owner.job.jobId,
      key,
      provider,
      providerJobId: owner.providerJobId,
      finalCredits,
      outputs,
      links: saved,
    });
  }
}

function tellEstimate(entry, unit) {
  const credits = Number(Number(entry.credits).toFixed(2));
  tell(`Price saved as ${entry.estimateId}: ${credits} ${unit} credits. Use this estimateId in pipeline_quote_save.`);
}

function sameResult(previous, next) {
  if (!previous) return false;
  return previous.status === next.status && previous.finalCredits === next.finalCredits &&
    previous.billingStatus === next.billingStatus &&
    (previous.outputAssetIds || []).join('|') === (next.outputAssetIds || []).join('|');
}

function recordThreeEchoResult(ctx) {
  const polled = ctx.data.job;
  if (!polled || ctx.data.waitTimedOut === true) return;
  const providerJobId = text(polled.jobId) || text(ctx.input.jobId);
  if (!providerJobId) return;
  const owner = findGenerationOwner(ctx.root, { providerJobId }, boundJob(ctx));
  if (!owner) return;
  const outputs = outputIdsOf(ctx.data);
  const usage = polled.usage || {};
  const entry = {
    type: 'result',
    provider: THREE_ECHO,
    tool: ctx.base,
    key: owner.create.key ?? null,
    providerJobId,
    status: polled.status ?? null,
    finalCredits: finite(usage.finalCostCreds),
    reservedCredits: finite(usage.reservedCostCreds),
    billingStatus: usage.billingStatus ?? null,
    outputAssetIds: outputs,
    assets: assetSummaries(ctx.data),
  };
  if (!sameResult(owner.result, entry)) appendRecord(owner.job, entry);
  const links = linksFor(ctx.data, outputs, null);
  land(owner, outputs, links, entry.finalCredits);
  if (polled.status !== 'succeeded') return;
  const missing = outputs.filter(id => !links.some(link => link.assetId === id) && !isLanded(owner.job, id));
  if (!missing.length) return;
  const records = readRecords(owner.job);
  const last = [...records].reverse().find(record => record.type === 'pending' && record.providerJobId === providerJobId);
  if (!last || (last.assetIds || []).join('|') !== missing.join('|')) {
    appendRecord(owner.job, { type: 'pending', provider: THREE_ECHO, key: owner.create.key ?? null, providerJobId, assetIds: missing, note: PENDING_NOTE });
  }
  tell(`${PENDING_NOTE} Asset ${missing.length > 1 ? 'ids' : 'id'}: ${missing.join(', ')}.`);
}

function recordThreeEchoAsset(ctx) {
  const assetId = text(ctx.input.assetId) || text(ctx.data.asset?.assetId) || text(ctx.data.assetId);
  if (!assetId) return;
  const owner = findGenerationOwner(ctx.root, { assetId }, boundJob(ctx));
  if (!owner) return;
  const outputs = Array.isArray(owner.result?.outputAssetIds) && owner.result.outputAssetIds.includes(assetId) ? owner.result.outputAssetIds : [assetId];
  const links = linksFor(ctx.data, [assetId], assetId).slice(0, 1);
  land(owner, outputs, links, finite(owner.result?.finalCredits));
}

function recordVideoEstimate(ctx) {
  const credits = finite(ctx.data.quotedCostCreds);
  if (credits === null) return;
  const job = resolveJobForCall({ root: ctx.root, sessionId: ctx.sessionId, toolInput: ctx.input });
  if (!job) return;
  tellEstimate(appendEstimate(job, {
    provider: THREE_ECHO,
    tool: ctx.base,
    priceKey: priceKey(ctx.base, ctx.input),
    credits,
    ...tagOf(job),
    inputs: pick(ctx.input, VIDEO_PRICE_FIELDS),
    details: pick(ctx.data, ['quotedCostUsd', 'quoteVersion', 'canReserve', 'availableBalanceCreds']),
  }), 'Studio');
}

function recordVoiceEstimate(ctx) {
  const estimate = ctx.data.estimate && typeof ctx.data.estimate === 'object' ? ctx.data.estimate : null;
  const credits = finite(estimate?.credits);
  if (credits === null) return;
  const job = resolveJobForCall({ root: ctx.root, sessionId: ctx.sessionId, toolInput: ctx.input });
  if (!job) return;
  tellEstimate(appendEstimate(job, {
    provider: ELEVEN_LABS,
    tool: ctx.base,
    priceKey: priceKey(ctx.base, ctx.input),
    credits,
    ...tagOf(job),
    inputs: pick(ctx.input, VOICE_INPUTS),
    details: {
      priceCents: finite(estimate.price_cents),
      generationsCount: finite(estimate.generations_count),
      currency: estimate.currency ?? null,
      flowId: ctx.data.flow_id ?? null,
      nodeId: ctx.data.node_id ?? null,
    },
  }), 'ElevenLabs');
}

function voiceCallId(data, toolUseId) {
  const sessions = Array.isArray(data.session_ids) ? data.session_ids.map(text).filter(Boolean) : [];
  return text(data.session_id) || sessions[0] || (text(data.flow_id) && text(data.node_id) ? `${data.flow_id}:${data.node_id}` : null) || text(toolUseId);
}

function recordVoiceCreate(ctx) {
  const job = resolveJobForCall({ root: ctx.root, sessionId: ctx.sessionId, toolInput: ctx.input });
  if (!job) return;
  const providerJobId = voiceCallId(ctx.data, ctx.toolUseId);
  if (!providerJobId) return;
  if (readRecords(job).some(record => record.type === 'create' && record.providerJobId === providerJobId)) return;
  const tag = tagOf(job);
  const estimate = latestEstimate(job, priceKey(ctx.base, ctx.input));
  const item = tag.key ? quoteItem(currentPriceApproval(job)?.quote, tag.key) : null;
  appendRecord(job, {
    type: 'create',
    provider: ELEVEN_LABS,
    tool: ctx.base,
    ...tag,
    kind: 'voice',
    providerJobId,
    reservedCredits: finite(estimate?.credits) ?? finite(item?.credits),
    estimateId: estimate?.estimateId ?? null,
    prompt: text(ctx.input.prompt) || text(ctx.input.text),
    inputs: pick(ctx.input, VOICE_INPUTS),
    flowId: ctx.data.flow_id ?? null,
    nodeId: ctx.data.node_id ?? null,
    sessionIds: Array.isArray(ctx.data.session_ids) ? ctx.data.session_ids : ctx.data.session_id ? [ctx.data.session_id] : [],
    priceKey: priceKey(ctx.base, ctx.input),
    sessionId: ctx.sessionId ?? null,
  });
  if (!isTranscriptionItem(tag.key || item)) startMediaIfDue(job);
}

function recordVoiceResult(ctx) {
  if (!voiceRunFinished(ctx.data)) return;
  const generations = voiceOutputs(ctx.data);
  if (!generations.length) return;
  const sessions = [...new Set([
    ...(Array.isArray(ctx.input.session_ids) ? ctx.input.session_ids : []),
    ...(Array.isArray(ctx.data.session_ids) ? ctx.data.session_ids : []),
    ctx.data.session_id,
  ].map(text).filter(Boolean))];
  const owner = findGenerationOwner(ctx.root, { sessionIds: sessions }, boundJob(ctx));
  if (!owner || owner.create.provider !== ELEVEN_LABS) return;
  const finished = generations.filter(output => output.ok);
  const outputs = finished.map(output => output.id);
  const key = owner.create.key ?? null;
  const entry = {
    type: 'result',
    provider: ELEVEN_LABS,
    tool: ctx.base,
    key,
    providerJobId: owner.providerJobId,
    status: finished.length ? (ctx.data.has_failures === true ? 'partial' : 'succeeded') : 'failed',
    finalCredits: voiceRunCredits(ctx.data, generations),
    reservedCredits: finite(owner.create.reservedCredits),
    billingStatus: null,
    outputAssetIds: outputs,
    assets: generations.map(output => ({ assetId: output.id, status: output.status, mimeType: output.mimeType, filename: output.filename })),
    flowId: text(ctx.input.flow_id) || text(ctx.data.flow_id),
    sessionIds: sessions,
  };
  if (!sameResult(owner.result, entry)) appendRecord(owner.job, entry);
  const links = finished.filter(output => output.url)
    .map(output => ({ assetId: output.id, url: output.url, mimeType: output.mimeType, filename: output.filename, expiresAt: output.expiresAt }));
  land(owner, outputs, links, entry.finalCredits);
  const waiting = finished.filter(output => !output.url && !isLanded(owner.job, output.id));
  if (!waiting.length) return;
  const records = readRecords(owner.job);
  const said = [];
  for (const reason of ['needs_sign_in', 'no_link']) {
    const assetIds = waiting.filter(output => (reason === 'needs_sign_in') === output.blocked).map(output => output.id);
    if (!assetIds.length) continue;
    said.push(VOICE_PENDING_NOTES[reason]);
    const last = [...records].reverse().find(record => record.type === 'pending' && record.providerJobId === owner.providerJobId && record.reason === reason);
    if (last && (last.assetIds || []).join('|') === assetIds.join('|')) continue;
    appendRecord(owner.job, { type: 'pending', provider: ELEVEN_LABS, key, providerJobId: owner.providerJobId, assetIds, reason, note: VOICE_PENDING_NOTES[reason] });
  }
  tell(said.join(' '));
}

async function main() {
  const event = await readEvent();
  if (!event) return;
  const base = toolBase(event.tool_name);
  const data = parseToolResponse(event.tool_response);
  if (!data || typeof data !== 'object') return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root) return;
  const ctx = { root, base, data, input: asObject(event.tool_input), sessionId: event.session_id ?? null, toolUseId: event.tool_use_id ?? null };
  if (base === 'create_image_job' || base === 'create_video_job') recordThreeEchoCreate(ctx);
  else if (base === 'wait_for_job' || base === 'get_job_result') recordThreeEchoResult(ctx);
  else if (base === 'get_asset') recordThreeEchoAsset(ctx);
  else if (base === 'estimate_video_job') recordVideoEstimate(ctx);
  else if (VOICE_RESULTS.includes(base)) recordVoiceResult(ctx);
  else if (VOICE_SPENDERS.includes(base)) {
    if (ctx.input.estimate_only === true) recordVoiceEstimate(ctx);
    else recordVoiceCreate(ctx);
  }
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
