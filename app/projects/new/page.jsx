/**
 * /projects/new — kept as an address, not as a second form.
 *
 * There were two ways to create a project and they had drifted apart. This
 * page still typed the client name into a text box and said on screen that
 * "there is no Contacts model yet", which stopped being true when contacts
 * shipped; the slide-over on the Project Hub picks a real contact, links it,
 * and can take a hand-typed case number. Two creation paths that disagree is
 * how a firm ends up with half its clients as records and half as strings.
 *
 * So the URL survives -- it is in the main menu and in muscle memory -- and it
 * opens the one form that exists.
 */

import { redirect } from 'next/navigation';

export default function NewProjectPage() {
  redirect('/projects?new=1');
}
