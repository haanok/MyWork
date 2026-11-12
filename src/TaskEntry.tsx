import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { formatDueLong, relativeDue, today } from './dates';
import { IconFlag, IconTrash } from './icons';
import type { Customer, Task, TaskStatus } from './types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  doing: 'In progress',
  done: 'Completed',
};

/** MIME type used when dragging a task card between kanban columns. */
export const TASK_DRAG_TYPE = 'application/x-mywork-task';

export function TaskEntry({
  task,
  onUpdate,
  onRemove,
  customer,
  onOpenCustomer,
  variant = 'row',
}: {
  task: Task;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onRemove: (id: string) => void;
  /** Shown as a link to the customer in cross-customer views. */
  customer?: Customer;
  onOpenCustomer?: (id: string) => void;
  /** `card` renders a compact, draggable card for the kanban board. */
  variant?: 'row' | 'card';
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [solution, setSolution] = useState(task.solution ?? '');
  const [due, setDue] = useState(task.due ?? '');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const overdue = !!task.due && task.due < today() && task.status !== 'done';
  const hasLongDescription = (task.description?.length ?? 0) > 180 || (task.description?.split('\n').length ?? 0) > 3;

  const save = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    onUpdate(task.id, { title: cleanTitle, description: description.trim(), solution: solution.trim() || undefined, due: due || undefined });
    setEditing(false);
  };

  const startEditing = () => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setSolution(task.solution ?? '');
    setDue(task.due ?? '');
    setEditing(true);
  };

  const dirty = title !== task.title || description !== (task.description ?? '') || solution !== (task.solution ?? '') || due !== (task.due ?? '');
  const cancelEdit = () => {
    if (dirty && !window.confirm('Discard unsaved changes to this task?')) return;
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelEdit();
    }
  };

  const isCard = variant === 'card';
  const [dragging, setDragging] = useState(false);
  const onDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
    event.dataTransfer.setData('text/plain', task.title);
    event.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };

  return (
    <article
      className={`task-entry${isCard ? ' is-card' : ''}${dragging ? ' is-dragging' : ''}${overdue ? ' is-overdue' : ''}${task.status === 'done' ? ' is-complete' : ''}`}
      draggable={isCard && !editing}
      onDragStart={isCard && !editing ? onDragStart : undefined}
      onDragEnd={isCard ? () => setDragging(false) : undefined}
    >
      <div className="task-date">
        {task.due ? (
          <>
            <strong>{formatDueLong(task.due)}</strong>
            <span>{overdue ? relativeDue(task.due) : task.status === 'done' ? 'Completed' : relativeDue(task.due)}</span>
          </>
        ) : (
          <><strong>No due date</strong><span>Unscheduled</span></>
        )}
      </div>
      <div className="task-content">
        {editing ? (
          <div className="task-editor">
            <input className="crm-field" aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={onKeyDown} autoFocus />
            <textarea className="crm-field" aria-label="Task description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={onKeyDown} placeholder="Add details and next steps" />
            <textarea className="crm-field" aria-label="Task solution" rows={3} value={solution} onChange={(event) => setSolution(event.target.value)} onKeyDown={onKeyDown} placeholder="Solution: what you did, for later reference" />
            <div className="editor-actions">
              <label className="date-control"><span>Due date</span><input className="crm-field" type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label>
              <button type="button" className="crm-secondary" onClick={cancelEdit}>Cancel</button>
              <button type="button" className="crm-primary small-primary" onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <div className="task-title-line">
              <h4>{task.title}</h4>
              {customer && (
                <button type="button" className="task-customer" onClick={() => onOpenCustomer?.(customer.id)} title={`Open ${customer.name || 'customer'}`}>
                  {customer.name || 'Untitled customer'}
                </button>
              )}
              {task.priority === 'high' && <span className="priority-mark"><IconFlag width={13} height={13} /> High</span>}
            </div>
            <p className={`task-description${task.description ? '' : ' is-blank'}${hasLongDescription && !descriptionExpanded ? ' is-collapsed' : ''}`}>
              {task.description || 'No description yet. Add the details needed to move this forward.'}
            </p>
            {task.solution && (
              <div className="task-solution">
                <span className="task-solution-label">Solution</span>
                <p>{task.solution}</p>
              </div>
            )}
            <div className="task-links">
              {hasLongDescription && (
                <button
                  type="button"
                  className="task-expand"
                  aria-expanded={descriptionExpanded}
                  onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                >
                  {descriptionExpanded ? 'Read less' : 'Read more'}
                </button>
              )}
              <button type="button" className="task-edit-link" onClick={startEditing}>Edit task</button>
            </div>
          </>
        )}
      </div>
      <div className="task-controls">
        <label className="status-select-label">
          <span className="visually-hidden">Status for {task.title}</span>
          <select className={`task-status-select st-${task.status}`} value={task.status} onChange={(event) => onUpdate(task.id, { status: event.target.value as TaskStatus })}>
            {(['open', 'doing', 'done'] as TaskStatus[]).map((status) => <option value={status} key={status}>{STATUS_LABEL[status]}</option>)}
          </select>
        </label>
          <button
            type="button"
            className={`icon-key subtle-icon priority-toggle${task.priority === 'high' ? ' is-on' : ''}`}
            aria-label={`${task.priority === 'high' ? 'Remove high priority from' : 'Mark'} ${task.title}`}
            aria-pressed={task.priority === 'high'}
            onClick={() => onUpdate(task.id, { priority: task.priority === 'high' ? 'normal' : 'high' })}
          >
            <IconFlag width={15} height={15} />
          </button>
          <button type="button" className="icon-key subtle-icon" aria-label={`Delete ${task.title}`} onClick={() => onRemove(task.id)}>
          <IconTrash width={16} height={16} />
        </button>
      </div>
    </article>
  );
}