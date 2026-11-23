import { llmsIndex, textFile } from '../../lib/llms';

export const dynamic = 'force-static';
export const GET = () => textFile(llmsIndex());
