const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AGENT_ACTIVE_STATES, AGENT_TERMINAL_STATES, AGENT_DELIVERABLE_STATES, AGENT_INTERRUPTED_STATES, AGENT_RECOVERABLE_ERRORS, agentCanRecover, agentHasBackgroundWork } = require('../dist/index.js');

test('a deliverable media reply is not an execution terminal state', () => {
  assert(AGENT_DELIVERABLE_STATES.includes('waiting_generation'));
  assert(!AGENT_TERMINAL_STATES.includes('waiting_generation'));
  for (const status of AGENT_TERMINAL_STATES) assert(!agentHasBackgroundWork({ status, delivered: true, hasGeneration: true }));
});

test('background continuation requires delivered generation intent and a recoverable execution state', () => {
  for (const status of [...AGENT_ACTIVE_STATES, 'waiting_generation', ...AGENT_INTERRUPTED_STATES]) {
    for (const errorCode of [null, ...AGENT_RECOVERABLE_ERRORS, 'PRECONDITION_CHANGED', 'INVALID_OPERATION', 'CHECKPOINT_INVALID', 'VERIFICATION_FAILED']) {
      const eligible = [...AGENT_ACTIVE_STATES, 'waiting_generation'].includes(status) || AGENT_RECOVERABLE_ERRORS.includes(errorCode);
      assert.equal(agentHasBackgroundWork({ status, errorCode, delivered: true, hasGeneration: true }), eligible, `${status}/${errorCode}`);
      assert(!agentHasBackgroundWork({ status, errorCode, delivered: false, hasGeneration: true }));
      assert(!agentHasBackgroundWork({ status, errorCode, delivered: true, hasGeneration: false }));
      if (AGENT_INTERRUPTED_STATES.includes(status) && !AGENT_RECOVERABLE_ERRORS.includes(errorCode)) assert(!agentCanRecover(status, errorCode));
    }
  }
});
