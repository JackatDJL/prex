import { llmsFull, textFile } from '../../lib/llms';

export const dynamic = 'force-static';
export const GET = async () => textFile(await llmsFull());
