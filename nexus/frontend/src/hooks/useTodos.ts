import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { apiFetch } from '../lib/api';
import type { TodoItem } from '../types';
import { wcRead, wcWrite, WC_KEY, awaitPrefetchOrFetch } from '../lib/widgetCache';

const ENDPOINT = '/api/todos';

export function useTodos() {
  const { todos, setTodos, addTodo, updateTodo, deleteTodo, todosRefetchKey } = useStore();

  // hasLoaded: immediately true when the Zustand store was seeded from cache
  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.TODOS) !== null,
  );

  const fetchTodos = async () => {
    try {
      const res = await awaitPrefetchOrFetch(ENDPOINT, () => apiFetch(ENDPOINT));
      if (!res.ok) return;
      const data: TodoItem[] = await res.json();
      const items = Array.isArray(data) ? data : [];
      setTodos(items);
      wcWrite(WC_KEY.TODOS, items);
    } catch {
      // Keep cached Zustand state on any error
    } finally {
      setHasLoaded(true);
    }
  };

  useEffect(() => {
    fetchTodos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (todosRefetchKey > 0) fetchTodos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todosRefetchKey]);

  const createTodo = async (
    text: string,
    priority: 'low' | 'medium' | 'high' = 'medium',
    dueDate?: string,
    dueTime?: string
  ): Promise<{ needsGoogleScope?: boolean }> => {
    const tempId = `temp-${Date.now()}`;
    addTodo({ id: tempId, text, completed: false, priority, dueDate, dueTime });

    try {
      const res = await apiFetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify({ text, priority, dueDate, dueTime }),
      });
      const saved: TodoItem = await res.json();
      updateTodo(tempId, saved);
      if (saved.id && saved.id !== tempId) {
        useStore.setState((s) => ({
          todos: s.todos.map((t) => (t.id === tempId ? { ...saved } : t)),
        }));
      }
    } catch {
      deleteTodo(tempId);
      return {};
    }

    if (dueDate) {
      try {
        const taskRes = await apiFetch('/api/calendar/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: text, dueDate, dueTime }),
        });
        if (taskRes.status === 403) {
          const body = (await taskRes.json()) as { error?: string };
          if (body.error === 'needsTasksScope') return { needsGoogleScope: true };
        }
      } catch {
        // Silent fail
      }
    }

    return {};
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;
    updateTodo(id, { completed: !todo.completed });
    try {
      await apiFetch(`/api/todos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ completed: !todo.completed }),
      });
    } catch {
      updateTodo(id, { completed: todo.completed });
    }
  };

  const removeTodo = async (id: string) => {
    const snapshot = todos.find((t) => t.id === id);
    deleteTodo(id);
    try {
      await apiFetch(`/api/todos/${id}`, { method: 'DELETE' });
    } catch {
      if (snapshot) addTodo(snapshot);
    }
  };

  const editTodo = async (
    id: string,
    updates: { text?: string; priority?: 'low' | 'medium' | 'high'; dueDate?: string; dueTime?: string }
  ) => {
    updateTodo(id, updates);
    try {
      await apiFetch(`/api/todos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    } catch {
      // Silent fail
    }
  };

  return { todos, createTodo, toggleTodo, removeTodo, editTodo, hasLoaded };
}
