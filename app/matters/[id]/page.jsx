import { redirect } from 'next/navigation';
import { DEFAULT_SECTION } from '@/lib/sections/registry';

/** A bare matter URL lands on Activity, as Filevine does. */
export default async function MatterIndex({ params }) {
  const { id } = await params;
  redirect(`/matters/${id}/${DEFAULT_SECTION}`);
}
