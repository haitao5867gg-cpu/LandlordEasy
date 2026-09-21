import { evaluateMysqlIntegrationGuard } from './guard';

const result = evaluateMysqlIntegrationGuard();
if (!result.allowed) {
  throw new Error(`REL-001 focused MySQL harness refused to run: ${result.reason}`);
}
