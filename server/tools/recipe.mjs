import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { chooseRecipe, saveRecipeOptions } from '../pipeline/recipe.mjs';

const string = { type: 'string' };
const evidence = {
  type: 'array',
  minItems: 1,
  maxItems: 5,
  items: string,
  description: 'Where this option comes from: a research file in the job such as research/competitors.md or research/customer.md#comments, a brand file such as brand/research.json, or a public https link to the post, ad or page.',
};
const common = {
  label: { ...string, description: 'A short plain label the person reads, at most 80 characters.' },
  reason: { ...string, description: 'One line on why this could work for this post, at most 240 characters.' },
  evidence,
};
const optionList = (properties, required, extra = {}) => ({
  type: 'array',
  minItems: 2,
  maxItems: 3,
  items: { type: 'object', properties: { ...common, ...properties }, required: ['label', 'reason', 'evidence', ...required], additionalProperties: false },
  ...extra,
});
const pillar = { pillar: { ...string, description: 'One of the brand\'s saved content pillars, as written on the brand profile.' } };
const angle = { angle: { ...string, description: 'The angle in one line, at most 200 characters.' } };
const hook = {
  family: { ...string, description: 'A hook family from the hook playbook, such as H-QUESTION or H-PROOF.' },
  mechanism: { ...string, description: 'One of that family\'s mechanisms, such as question or cold_open_result.' },
  example: { ...string, description: 'An example first line in that mechanism. A question mechanism needs a question mark; a number-led one needs a real number.' },
};
const cta = {
  style: { type: 'string', enum: ['link_caption', 'link_bio', 'story_sticker', 'comment_keyword', 'dm', 'save', 'share_send', 'question', 'follow', 'none'] },
  line: { ...string, description: 'The call to action as the person will read it. May be empty only for style none.' },
};
const tags = { tags: { type: 'array', maxItems: 30, items: string, description: 'The hashtags, each starting with #, no repeats. An empty list means no hashtags, which suits Facebook.' } };
const pick = (written) => ({
  type: 'object',
  properties: {
    option: { ...string, description: 'The id of the offered option the person picked, such as hook-2.' },
    written: { type: 'object', properties: written, additionalProperties: false, description: 'The person\'s own choice, in their words, when they picked none of the options.' },
  },
  additionalProperties: false,
});

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

export const recipeTools = [
  defineTool({
    name: 'pipeline_recipe_options_save',
    description: 'Save the choices offered for one post (D1, D2 and so on) at the concept step: 2 or 3 options each for the content pillar, the angle, the hook family, the call to action and the hashtag set. Every option has a short label, a one-line reason and its evidence from the job\'s research or a public link. Pillars must be the brand\'s own; each hook family option carries its mechanism and an example first line that reads that way; a hashtag set has no repeats and at most 30 tags. Refuses while the brand voice is unfinished and says what is missing. Refuses when a recipe is already chosen unless replace is true, which clears that choice so the person picks again. Returns each option\'s id and label.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: string,
        deliverable: { ...string, description: 'The post, D1, D2 and so on.' },
        options: {
          type: 'object',
          properties: {
            pillar: optionList(pillar, ['pillar'], { minItems: 1, description: '2 or 3 of the brand\'s pillars; just 1 when the brand has only one.' }),
            angle: optionList(angle, ['angle']),
            hookFamily: optionList(hook, ['family', 'mechanism', 'example']),
            cta: optionList(cta, ['style', 'line']),
            hashtags: optionList(tags, ['tags']),
          },
          required: ['pillar', 'angle', 'hookFamily', 'cta', 'hashtags'],
          additionalProperties: false,
        },
        replace: { type: 'boolean', description: 'True only when the person wants new options after already choosing; their earlier choice is cleared.' },
      },
      required: ['brand', 'jobId', 'deliverable', 'options'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => saveRecipeOptions({ ...args, root: local(workspace) }),
  }),
  defineTool({
    name: 'pipeline_recipe_choose',
    description: 'Save what the person chose for one post as its recipe: per field, the id of an offered option or their own written-in choice. The first choice names all five fields (pillar, angle, hookFamily, cta, hashtags); a later change may name only the fields that change and keeps the rest. Records who chose, when, and whether it came from the board (with the board request id) or from chat. Copy for the post is written only from this recipe.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: string,
        jobId: string,
        deliverable: { ...string, description: 'The post, D1, D2 and so on.' },
        picks: {
          type: 'object',
          properties: {
            pillar: pick(pillar),
            angle: pick(angle),
            hookFamily: pick(hook),
            cta: pick(cta),
            hashtags: pick(tags),
          },
          additionalProperties: false,
        },
        chosenBy: { ...string, description: 'Who chose: the person\'s name, or the board request that carried the choice.' },
        via: { type: 'string', enum: ['board', 'chat'] },
        requestId: { ...string, description: 'The board request id, required when via is board.' },
        note: { ...string, description: 'The person\'s own words about the choice, if any.' },
      },
      required: ['brand', 'jobId', 'deliverable', 'picks', 'chosenBy', 'via'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => chooseRecipe({ ...args, root: local(workspace) }),
  }),
];
