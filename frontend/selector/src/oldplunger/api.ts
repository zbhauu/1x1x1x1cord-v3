import React from 'react';

export const API_VERSION = '1.0.0';

export interface ModalOptions {
  title: string;
  content: React.ReactNode;
  onClose?: () => void;
}

export function showModal(options: ModalOptions): void {
  try {
    const ModalStack = (window as any).Discord?.ModalStack || (window as any).ModalStack;
    if (!ModalStack) throw new Error('ModalStack not found');
    ModalStack.push(() => (
      <div className="oldplunger-modal">
        <h2>{options.title}</h2>
        <div>{options.content}</div>
        <button onClick={options.onClose}>Close</button>
      </div>
    ));
  } catch (e) {
    console.error('[Oldplunger] showModal error:', e);
  }
}

export function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  try {
    const ToastManager = (window as any).Discord?.ToastManager || (window as any).ToastManager;
    if (!ToastManager) throw new Error('ToastManager not found');
    ToastManager.show(message, { type });
  } catch (e) {
    console.error('[Oldplunger] showToast error:', e);
  }
}

export interface SettingsPanel {
  id: string;
  label: string;
  component: React.ComponentType;
}

const settingsPanels = new Map<string, SettingsPanel>();

export function addSettingsPanel(panel: SettingsPanel): void {
  settingsPanels.set(panel.id, panel);
  window.dispatchEvent(new CustomEvent('oldplunger:settingsPanelAdded', { detail: panel }));
}

export interface ComponentPatch {
  componentName: string;
  patch: (Component: React.ComponentType) => React.ComponentType;
}

const patches = new Map<string, ComponentPatch>();

export function patchComponent(componentName: string, patch: (Component: React.ComponentType) => React.ComponentType): void {
  patches.set(componentName, { componentName, patch });
  window.dispatchEvent(new CustomEvent('oldplunger:componentPatched', { detail: { componentName, patch } }));
}
