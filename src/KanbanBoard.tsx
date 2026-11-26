import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type SyntheticEvent } from 'react';
import { today } from './dates';
import { IconClose, IconFlag, IconPlus } from './icons';
import { STATUS_LABEL, TASK_DRAG_TYPE, TaskEntry, type KanbanCardMode } from './TaskEntry';
import type { Customer, Priority, Task, TaskStatus } from './types';
import { DateField } from './DateField';

const COLUMNS: TaskStatus[] = ['open', 'doing', 'waiting', 'done'];

interface Props {
  tasks: Task[];
  onAddTask: (title: string, description: string, priority: Priority, due: string | undefined, status: TaskStatus) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
  moveTargets?: Customer[];
  /** Customer shown as context in the focus view. */
  customer?: Customer;
  cardMode?: KanbanCardMode;
}

function sortColumn(status: TaskStatus, list: Task[]) {
  return [...list].sort((a, b) => {
    if (status === 'done') return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
    return (
      (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
      || (a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31')
      || a.createdAt.localeCompare(b.createdAt)
    );
  });
}

/** Tasks for one customer grouped by status. Cards can be dragged between columns. */
export function KanbanBoard({ tasks, onAddTask, onUpdateTask, onRemoveTask, moveTargets, customer, cardMode = 'expand' }: Props) {
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [composerFor, setComposerFor] = useState<TaskStatus | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focusTask = focusId ? tasks.find((task) => task.id === focusId) ?? null : null;

  // Close the focus view when its task is deleted or moved to another customer.
  useEffect(() => {
    if (focusId && !focusTask) setFocusId(null);
  }, [focusId, focusTask]);

  const columns = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { open: [], doing: [], waiting: [], done: [] };
    for (const task of tasks) grouped[task.status]?.push(task);
    for (const status of COLUMNS) grouped[status] = sortColumn(status, grouped[status]);
    return grouped;
  }, [tasks]);

  const isTaskDrag = (event: DragEvent) => event.dataTransfer.types.includes(TASK_DRAG_TYPE);

  const onDrop = (status: TaskStatus) => (event: DragEvent<HTMLElement>) => {
    if (!isTaskDrag(event)) return;
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData(TASK_DRAG_TYPE);
    const task = tasks.find((entry) => entry.id === id);
    if (task && task.status !== status) onUpdateTask(id, { status });
  };

  return (
    <div className="kanban-board" aria-label="Task board">
      {COLUMNS.map((status) => {
        const list = columns[status];
        const overdue = status !== 'done' ? list.filter((task) => task.due && task.due < today()).length : 0;
        return (
          <section
            key={status}
            className={`kanban-column st-${status}${dropTarget === status ? ' is-drop-target' : ''}`}
            aria-label={`${STATUS_LABEL[status]} tasks`}
            onDragOver={(event) => {
              if (!isTaskDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (dropTarget !== status) setDropTarget(status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
            }}
            onDrop={onDrop(status)}
          >
            <header className="kanban-column-head">
              <h3>
                <span className={`kanban-dot st-${status}`} aria-hidden="true" />
                {STATUS_LABEL[status]}
                <span className="kanban-count">{list.length}</span>
              </h3>
              {overdue > 0 && <span className="kanban-overdue">{overdue} overdue</span>}
              <button
                type="button"
                className="icon-key subtle-icon kanban-add-key"
                aria-label={`Add task to ${STATUS_LABEL[status]}`}
                title={`Add task to ${STATUS_LABEL[status]}`}
                aria-expanded={composerFor === status}
                onClick={() => setComposerFor((current) => (current === status ? null : status))}
              >
                <IconPlus width={15} height={15} />
              </button>
            </header>

            <div className="kanban-cards">
              {composerFor === status && (
                <ColumnComposer
                  status={status}
                  onCancel={() => setComposerFor(null)}
                  onSubmit={(title, description, priority, due) => onAddTask(title, description, priority, due, status)}
                />
              )}
              {list.length === 0 && composerFor !== status ? (
                <p className="kanban-empty">{status === 'done' ? 'Drop finished tasks here.' : 'No tasks here.'}</p>
              ) : list.map((task) => (
                <TaskEntry
                  key={task.id}
                  task={task}
                  variant="card"
                  cardMode={cardMode}
                  onEnhance={setFocusId}
                  onUpdate={onUpdateTask}
                  onRemove={onRemoveTask}
                  moveTargets={moveTargets}
                />
              ))}
            </div>

            {composerFor !== status && status !== 'done' && (
              <button type="button" className="kanban-add-row" onClick={() => setComposerFor(status)}>
                <IconPlus width={14} height={14} /> Add task
              </button>
            )}
          </section>
        );
      })}
      {focusTask && (
        <TaskFocusDialog
          key={focusTask.id}
          task={focusTask}
          customer={customer}
          moveTargets={moveTargets}
          onUpdate={onUpdateTask}
          onRemove={onRemoveTask}
          onClose={() => setFocusId(null)}
        />
      )}
    </div>
  );
}

/** Enlarged view of a single task, opened from a kanban card in "click to enhance" mode. */
function TaskFocusDialog({
  task,
  customer,
  moveTargets,
  onUpdate,
  onRemove,
  onClose,
}: {
  task: Task;
  customer?: Customer;
  moveTargets?: Customer[];
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `task-focus-${task.id}`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => ref.current?.close();

  // Escape inside the task editor cancels the edit instead of closing the whole view.
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (ref.current?.querySelector('.task-entry.is-editing')) event.preventDefault();
  };

  return (
    <dialog
      ref={ref}
      className="import-dialog task-focus-dialog"
      aria-labelledby={titleId}
      onCancel={onCancel}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="mcp-head task-focus-head">
        <p id={titleId} className="task-focus-context">
          <span className={`kanban-dot st-${task.status}`} aria-hidden="true" />
          <span>{STATUS_LABEL[task.status]}</span>
          {customer && <><span aria-hidden="true">·</span><span>{customer.name || 'Untitled customer'}</span></>}
          <span className="visually-hidden">: {task.title}</span>
        </p>
        <button type="button" className="icon-key" onClick={close} aria-label="Close focus view">
          <IconClose width={16} height={16} />
        </button>
      </div>
      <TaskEntry
        task={task}
        variant="detail"
        customer={customer}
        moveTargets={moveTargets}
        onUpdate={onUpdate}
        onRemove={(id) => { onRemove(id); close(); }}
      />
    </dialog>
  );
}

function ColumnComposer({
  status,
  onSubmit,
  onCancel,
}: {
  status: TaskStatus;
  onSubmit: (title: string, description: string, priority: Priority, due: string | undefined) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    onSubmit(cleanTitle, description.trim(), priority, due || undefined);
    setTitle('');
    setDescription('');
    setDue('');
    setPriority('normal');
    titleRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="kanban-composer" onSubmit={submit} onKeyDown={onKeyDown} aria-label={`New ${STATUS_LABEL[status]} task`}>
      <input
        ref={titleRef}
        className="crm-field"
        aria-label="Task title"
        placeholder="Task title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        autoComplete="off"
      />
      <textarea
        className="crm-field"
        aria-label="Task description"
        placeholder="Description, next steps, or call notes"
        rows={2}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="kanban-composer-row">
        <label className="date-control">
          <span>Due date</span>
          <DateField label="Due date" value={due} onChange={setDue} />
        </label>
        <div className="priority-control" role="group" aria-label="Task priority">
          <button type="button" className={priority === 'normal' ? 'is-active' : ''} aria-pressed={priority === 'normal'} onClick={() => setPriority('normal')}>Normal</button>
          <button type="button" className={priority === 'high' ? 'is-active' : ''} aria-pressed={priority === 'high'} onClick={() => setPriority('high')}>
            <IconFlag width={14} height={14} /> High
          </button>
        </div>
      </div>
      <div className="editor-actions">
        <button type="button" className="crm-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="crm-primary small-primary" disabled={!title.trim()}>Add task</button>
      </div>
    </form>
  );
}
