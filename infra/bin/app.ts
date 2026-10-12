// The CDK app: one stack, in us-east-1. Run through `pnpm --filter @cobweb/infra synth`; Node runs
// this file as it is (type stripping), so there is no build step.
import { App } from 'aws-cdk-lib'
import { RenderStack } from '../lib/render-stack.ts'

const app = new App()
new RenderStack(app, 'CobwebRender', { env: { region: 'us-east-1' } })
