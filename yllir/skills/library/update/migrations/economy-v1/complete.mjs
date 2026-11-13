// economy-v1: the guided part is finished when the economy document exists or the master deferred.
import { completeEconomyQuestion } from '../../scripts/lib/economy-question.mjs';

export function complete(root) {
  return completeEconomyQuestion(root);
}
