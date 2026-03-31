/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import type { WidgetProps } from './WidgetRenderer';

interface CredentialField {
  name: string;
  label: string;
  type: 'text' | 'password';
  required?: boolean;
}

interface CredentialInputData {
  connection_name: string;
  app_id: string;
  fields: CredentialField[];
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export function CredentialInput({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as CredentialInputData;

  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleChange = useCallback((fieldName: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setStatus('submitting');
      setErrorMessage('');

      try {
        const origin = window.location.origin;
        const url = `${origin}/api/apps/${d.app_id}/secrets`;

        for (const field of d.fields) {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: field.name,
              value: values[field.name] ?? '',
              connection_name: d.connection_name,
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to save ${field.label}: ${String(response.status)}`);
          }
        }

        setStatus('success');
        // Clear values from memory after successful submission
        setValues({});
        sendMessage(`Credentials for ${d.connection_name} have been saved.`);
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to save credentials');
      }
    },
    [d.app_id, d.connection_name, d.fields, values, sendMessage],
  );

  if (status === 'success') {
    return (
      <div className="pcw-widget-card pcw-widget-card--credential-input">
        <div className="pcw-credential-input__status pcw-credential-input__status--success">
          Credentials for {d.connection_name} saved successfully.
        </div>
      </div>
    );
  }

  return (
    <div className="pcw-widget-card pcw-widget-card--credential-input">
      <div className="pcw-credential-input__title">
        Configure {d.connection_name}
      </div>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        {d.fields.map((field) => (
          <div key={field.name} className="pcw-credential-input__field">
            <label className="pcw-credential-input__label" htmlFor={`pcw-cred-${field.name}`}>
              {field.label}
              {field.required && <span aria-hidden="true"> *</span>}
            </label>
            <input
              id={`pcw-cred-${field.name}`}
              className="pcw-credential-input__input"
              type={field.type}
              required={field.required}
              autoComplete={field.type === 'password' ? 'new-password' : 'off'}
              value={values[field.name] ?? ''}
              disabled={status === 'submitting'}
              onChange={(e) => handleChange(field.name, e.target.value)}
            />
          </div>
        ))}
        {status === 'error' && (
          <div className="pcw-credential-input__status pcw-credential-input__status--error">
            {errorMessage}
          </div>
        )}
        <button
          type="submit"
          className="pcw-credential-input__submit"
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Saving...' : 'Save Credentials'}
        </button>
      </form>
    </div>
  );
}
