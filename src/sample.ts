import { addDays, uid } from './dates';
import type { AppData, Customer, CustomerStatus, Task } from './types';

// Synthetic demo data: every name, person and note below is invented.
export function sampleData(): AppData {
  const now = new Date().toISOString();
  const customers: Customer[] = [];
  const tasks: Task[] = [];

  const customer = (
    name: string,
    status: CustomerStatus,
    notes: string,
    contacts: [string, string][],
  ) => {
    const c: Customer = {
      id: uid(),
      name,
      status,
      notes,
      contacts: contacts.map(([n, d]) => ({ id: uid(), name: n, detail: d })),
      createdAt: now,
      touchedAt: now,
    };
    customers.push(c);
    return c.id;
  };

  const task = (
    customerId: string,
    title: string,
    due?: number,
    opts: Partial<Pick<Task, 'status' | 'priority' | 'description'>> = {},
  ) => {
    tasks.push({
      id: uid(),
      customerId,
      title,
      description: opts.description,
      status: opts.status ?? 'open',
      priority: opts.priority ?? 'normal',
      due: due === undefined ? undefined : addDays(due),
      createdAt: now,
      doneAt: opts.status === 'done' ? now : undefined,
    });
  };

  const a = customer('Halden Marine', 'active', 'Fleet scheduling rewrite. Weekly call Thursdays.', [
    ['Ingrid Solheim', 'ops lead, ingrid@example.test'],
  ]);
  task(a, 'Review berth-allocation model', -2, {
    priority: 'high',
    description:
      'Ingrid flagged that berth swaps ignore tide windows. Check the constraint solver output against last week\'s manual schedule and list every mismatch.\n\nShare findings before the Thursday call.',
  });
  task(a, 'Send revised estimate', 3, {
    description: 'Include the extra week for tide-window constraints. Hourly rate unchanged.',
  });
  task(a, 'Draft Thursday call agenda', 1, { status: 'doing', description: 'Open issues, estimate, next sprint scope.' });
  task(a, 'Kickoff workshop notes', -9, { status: 'done' });

  const b = customer('Brightwater Dental', 'active', 'Booking site migration.', [
    ['Dr. Amir Haddad', 'owner'],
  ]);
  task(b, 'Migrate appointment reminders', 5);
  task(b, 'Test SMS provider fallback', 8);

  const c = customer('Karst & Lowe', 'waiting', 'Waiting on legal sign-off for the data agreement.', []);
  task(c, 'Chase signed agreement', -1, {
    priority: 'high',
    description: 'Second reminder. Their legal contact is out until Monday; copy the account owner.',
  });

  const d = customer('Oakline Bikes', 'active', 'Inventory sync between shop floor and web store.', [
    ['Mette Aas', 'mette@example.test'],
  ]);
  task(d, 'Fix duplicate SKU import', 2, {
    priority: 'high',
    description: 'Nightly import creates a second product when the supplier code has a trailing space. Trim and dedupe, then clean the existing duplicates.',
  });
  task(d, 'Document nightly sync', 12);
  task(d, 'Pricing rules walkthrough', 4);

  const e = customer('Tidewell Coffee', 'active', '', []);
  task(e, 'Loyalty card prototype', 9);

  const f = customer('Ferrow Architects', 'active', 'Plan archive search. Prefers email over calls.', [
    ['Jonas Eide', 'jonas@example.test'],
  ]);
  task(f, 'Index scanned drawings', 6, { status: 'doing' });
  task(f, 'Access review for contractors', 14);

  customer('Larkspur School', 'paused', 'Resumes in January.', []);

  const h = customer('Vantage Print', 'active', '', []);
  task(h, 'Quote template cleanup', undefined, { status: 'done' });

  const i = customer('Nordhavn Logistics', 'active', 'Dock-door scheduling pilot.', []);
  task(i, 'Pilot readout deck', 7);
  task(i, 'Collect driver feedback', 3);
  task(i, 'Reconcile gate timestamps', -4);

  return { version: 1, customers, tasks };
}
