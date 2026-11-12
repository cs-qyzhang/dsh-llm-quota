export const balance = {
  preset: 'balance', title: { key: 'balanceTitle' },
  history: [
    { key: 'amount', path: 'amount', unit: 'currency', label: { key: 'metricAmount' } },
    { key: 'cycleUsage', path: 'cycleUsage', unit: 'currency', label: { key: 'metricCycleUsage' } },
  ],
}

export const credits = {
  preset: 'credits',
  history: [{ key: 'amount', path: 'amount', unit: 'currency', label: { key: 'metricAmount' } }],
}

export const usage = {
  preset: 'usage',
  history: [{ key: 'usedAmount', path: 'usedAmount', unit: 'currency', label: { key: 'metricUsedAmount' } }],
}

export const plan = {
  preset: 'plan',
  history: [
    { key: 'fiveHour', path: 'fiveHour.remainingPercent', unit: 'percent', label: { key: 'fiveHourName' } },
    { key: 'weekly', path: 'weekly.remainingPercent', unit: 'percent', label: { key: 'weeklyName' } },
    { key: 'monthly', path: 'monthly.remainingPercent', unit: 'percent', label: { key: 'monthlyName' } },
  ],
}
