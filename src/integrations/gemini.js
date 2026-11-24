'use strict';

// Prompts and API formatting are isolated from routing and delivery decisions.
// These safeguards are provisional and do not make the prototype a medical system.
const {AUTO_PROMPT} = require('../workflow/constitution');

function createGemini(external, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  async function generate(prompt, text, generationConfig) {
    const request = {
      systemInstruction: {parts: [{text: prompt}]},
      contents: [{role: 'user', parts: [{text}]}],
      generationConfig: {...generationConfig, ...(model === 'gemini-3.8-flash' ? {thinkingConfig: {thinkingLevel: 'low'}} : {})}
    };
    const response = await external(url, request, {'x-goog-api-key': apiKey});
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('invalid_response');
    return candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('').trim() || '';
  }
  async function decide(history) {
    const raw = await generate(AUTO_PROMPT, 'История тестового диалога:\n' + history, {
      responseMimeType: 'application/json', maxOutputTokens: 2048
    });
    const decision = JSON.parse(raw);
    if (!decision || !['reply', 'handoff'].includes(decision.action) ||
        typeof decision.reply !== 'string' || typeof decision.reason !== 'string' ||
        typeof decision.summary !== 'string') throw new Error('invalid_response');
    return decision;
  }
  return {decide};
}
module.exports = {createGemini, AUTO_PROMPT};
