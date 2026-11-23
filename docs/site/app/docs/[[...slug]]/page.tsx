import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import components from 'fumadocs-ui/mdx';
import { source } from '../../../lib/source';

type Props = { params: Promise<{ slug?: string[] }> };

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}

export default async function Page({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Content = page.data.body;
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody><Content components={components} /></DocsBody>
    </DocsPage>
  );
}
