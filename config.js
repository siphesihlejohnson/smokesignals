'use strict';

const CONFIG = {
  APP_NAME: 'Smoke Signals',
  BRANCH: 'Cape Town',
  CURRENCY: 'R',
  LOW_STOCK_THRESHOLD: 10,
  SESSION_TIMEOUT_MINUTES: 30,
  LOCKOUT_MINUTES: 5,
  MAX_FAILED_ATTEMPTS: 3,
  VERSION: '1.0.0',
  SETUP_CODE: 'SMOKE420NETWORK',

  KEYS: {
    SALES:        'ssignals_sales',
    PRODUCTS:     'ssignals_products',
    CUSTOMERS:    'ssignals_customers',
    STAFF:        'ssignals_staff',
    AUDIT:        'ssignals_audit',
    RESTOCKS:     'ssignals_restocks',
    SETTINGS:     'ssignals_settings',
    SESSION:      'ssignals_session',
    SYNC_QUEUE:   'ssignals_syncQueue',
    INITIALIZED:  'ssignals_initialized',
    LAST_SYNC:    'ssignals_lastSync',
    SYNC_HISTORY: 'ssignals_syncHistory',
    ACTIVE_TAB:   'ssignals_activeTab',
  },

  SEED_STAFF: [
    { id: 'GHST',   name: 'GHST',   role: 'admin', pinHash: null, active: true, failedAttempts: 0, lockedUntil: null, lastLogin: null },
    { id: 'RAY',    name: 'RAY',    role: 'admin', pinHash: null, active: true, failedAttempts: 0, lockedUntil: null, lastLogin: null },
    { id: 'STAFF1', name: 'STAFF1', role: 'staff', pinHash: null, active: true, failedAttempts: 0, lockedUntil: null, lastLogin: null },
    { id: 'STAFF2', name: 'STAFF2', role: 'staff', pinHash: null, active: true, failedAttempts: 0, lockedUntil: null, lastLogin: null },
    { id: 'STAFF3', name: 'STAFF3', role: 'staff', pinHash: null, active: true, failedAttempts: 0, lockedUntil: null, lastLogin: null },
  ],

  SEED_PRODUCTS: [
    { id: 'PROD_001', name: 'Indoor Prerolls', category: 'Prerolls', unit: 'each', price: 70,  stock: 45, sold: 5,  active: true },
    { id: 'PROD_002', name: 'Gummies',         category: 'Edibles',  unit: 'each', price: 25,  stock: 42, sold: 8,  active: true },
    { id: 'PROD_003', name: 'Prerolls',         category: 'Prerolls', unit: 'each', price: 60,  stock: 50, sold: 0,  active: true },
    { id: 'PROD_004', name: 'AA Indoor',        category: 'Flower',   unit: 'gram', price: 80,  stock: 50, sold: 0,  active: true },
    { id: 'PROD_005', name: 'AAA Indoor',       category: 'Flower',   unit: 'gram', price: 110, stock: 50, sold: 0,  active: true },
  ],
};
