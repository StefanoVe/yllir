// economy-v1: the economy question. Needed while the campaign has no economy document and the
// master has not said «later». Pending while the question is open (guided.md asks it).
import { applyEconomyQuestion, detectEconomyQuestion } from '../../scripts/lib/economy-question.mjs';

/** True while the question is open. */
export function detect(root) {
  return detectEconomyQuestion(root) === true;
}

/** Pending while the question is open, complete when it is answered or deferred. Writes nothing. */
export function apply(root) {
  return applyEconomyQuestion(root);
}
