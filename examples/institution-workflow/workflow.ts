import { createStep, createWorkflow } from '@kimchi-dev/kimchi-workflows/flow';
import { Type } from 'typebox';

const textSchema = Type.Object({ text: Type.String() });
const countSchema = Type.Object({
  text: Type.String(),
  wordCount: Type.Integer({ minimum: 0 }),
});

export default createWorkflow({
  name: 'institution-workflow-demo',
  description: 'Prepare text, count words, and return an offline summary.',
  input: Type.String(),
  maxConcurrency: 1,
})
  .then(createStep({
    name: 'prepare',
    input: Type.String(),
    output: textSchema,
    run: ({ input }) => ({ text: input.trim() }),
  }))
  .then(createStep({
    name: 'count',
    input: textSchema,
    output: countSchema,
    run: ({ input }) => ({
      text: input.text,
      wordCount: input.text ? input.text.split(/\s+/u).length : 0,
    }),
  }))
  .then(createStep({
    name: 'summarize',
    input: countSchema,
    output: Type.Object({ message: Type.String() }),
    run: ({ input }) => ({
      message: `Processed ${input.wordCount} words: ${input.text}`,
    }),
  }))
  .commit();
