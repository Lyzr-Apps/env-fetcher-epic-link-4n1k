'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import type { AIAgentResponse } from '@/lib/aiAgent'
import { FiSearch, FiCopy, FiClock, FiTrash2, FiSettings, FiTerminal, FiAlertCircle, FiRefreshCw, FiChevronUp, FiChevronDown, FiCheck, FiZap, FiActivity, FiList } from 'react-icons/fi'

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_ID = '69a0810b6e827eaf7ecbd044'
const HISTORY_KEY = 'envfetch_query_history'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnvVariable {
  name: string
  value: string
  confidence: 'high' | 'medium' | 'low'
}

interface QueryHistoryItem {
  id: string
  query: string
  timestamp: string
  resultCount: number
}

interface AgentResult {
  query_interpretation: string
  variables: EnvVariable[]
  total_found: number
  message: string
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME_VARS: React.CSSProperties & Record<string, string> = {
  '--background': '70 10% 12%',
  '--foreground': '60 30% 96%',
  '--card': '70 10% 16%',
  '--card-foreground': '60 30% 96%',
  '--popover': '70 10% 20%',
  '--primary': '52 100% 62%',
  '--primary-foreground': '70 10% 10%',
  '--secondary': '70 10% 22%',
  '--secondary-foreground': '60 30% 96%',
  '--accent': '80 80% 50%',
  '--accent-foreground': '70 10% 8%',
  '--destructive': '338 95% 55%',
  '--muted': '70 10% 26%',
  '--muted-foreground': '50 6% 58%',
  '--border': '70 8% 22%',
  '--input': '70 8% 28%',
  '--ring': '80 76% 53%',
  '--sidebar-background': '70 8% 13%',
  '--sidebar-foreground': '60 30% 96%',
  '--sidebar-border': '70 8% 20%',
  '--sidebar-primary': '80 76% 53%',
  '--chart-1': '80 76% 53%',
  '--chart-2': '338 95% 56%',
  '--chart-3': '190 81% 67%',
  '--chart-4': '261 100% 75%',
  '--chart-5': '35 100% 50%',
  '--radius': '0rem',
} as React.CSSProperties

// ─── Response Parser ──────────────────────────────────────────────────────────

function tryParseJsonString(val: any): any {
  if (typeof val !== 'string') return val
  const trimmed = val.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return val
    }
  }
  return val
}

function extractAgentData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  // If the object already has 'variables' array, it's the target
  if (Array.isArray(obj.variables)) return obj

  // Try nested string fields that might contain JSON
  for (const key of ['text', 'response', 'result', 'data', 'content', 'output']) {
    if (obj[key] !== undefined) {
      const parsed = tryParseJsonString(obj[key])
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.variables)) {
        return parsed
      }
    }
  }

  return obj
}

function parseAgentResponse(result: AIAgentResponse): AgentResult | null {
  if (!result.success || !result.response) return null

  // Start from result.response.result
  let data: any = result.response.result

  // Step 1: If data is a string, try parsing as JSON
  data = tryParseJsonString(data)

  // Step 2: If data is still not the right shape, try extracting from nested fields
  if (data && typeof data === 'object' && !Array.isArray(data.variables)) {
    data = extractAgentData(data)
  }

  // Step 3: Also check result.response itself (in case normalizeResponse put it at top level)
  if (!data || typeof data !== 'object' || !Array.isArray(data.variables)) {
    const responseLevel = result.response as any
    if (responseLevel && typeof responseLevel === 'object') {
      // Check if the response object itself has variables
      if (Array.isArray(responseLevel.variables)) {
        data = responseLevel
      } else {
        // Try result.response.result again with deeper extraction
        const resultField = responseLevel.result
        if (resultField && typeof resultField === 'object') {
          const extracted = extractAgentData(resultField)
          if (extracted && Array.isArray(extracted.variables)) {
            data = extracted
          }
        }
      }
    }
  }

  // Step 4: Try the raw_response field as last resort
  if ((!data || typeof data !== 'object' || !Array.isArray(data.variables)) && (result as any).raw_response) {
    let rawVal = (result as any).raw_response
    // raw_response could be a string containing JSON, possibly nested
    for (let depth = 0; depth < 3; depth++) {
      rawVal = tryParseJsonString(rawVal)
      if (rawVal && typeof rawVal === 'object') {
        // Check this level
        if (Array.isArray(rawVal.variables)) {
          data = rawVal
          break
        }
        // Check nested response field
        if (rawVal.response) {
          const inner = tryParseJsonString(rawVal.response)
          if (inner && typeof inner === 'object' && Array.isArray(inner.variables)) {
            data = inner
            break
          }
          rawVal = rawVal.response
          continue
        }
        // Try extracting from known keys
        const extracted = extractAgentData(rawVal)
        if (extracted && Array.isArray(extracted.variables)) {
          data = extracted
          break
        }
        break
      } else {
        break
      }
    }
  }

  // Step 5: Last-ditch - scan all string values at result.response.result for embedded JSON with variables
  if (!data || typeof data !== 'object' || !Array.isArray(data.variables)) {
    const resultObj = result.response?.result
    if (resultObj && typeof resultObj === 'object') {
      for (const val of Object.values(resultObj)) {
        if (typeof val === 'string' && val.includes('variables')) {
          const parsed = tryParseJsonString(val)
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.variables)) {
            data = parsed
            break
          }
        }
      }
    }
  }

  // Validate we have a usable object
  if (!data || typeof data !== 'object') return null

  return {
    query_interpretation: data.query_interpretation ?? data.queryInterpretation ?? data.interpretation ?? '',
    variables: Array.isArray(data.variables) ? data.variables.map((v: any) => ({
      name: typeof v?.name === 'string' ? v.name : String(v?.name ?? ''),
      value: typeof v?.value === 'string' ? v.value : String(v?.value ?? 'not set'),
      confidence: ['high', 'medium', 'low'].includes(v?.confidence) ? v.confidence : 'low',
    })) : [],
    total_found: typeof data.total_found === 'number' ? data.total_found : (Array.isArray(data.variables) ? data.variables.length : 0),
    message: data.message ?? '',
  }
}

// ─── Markdown Renderer ───────────────────────────────────────────────────────

function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">{part}</strong>
    ) : (
      part
    )
  )
}

function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} className="font-semibold text-sm mt-2 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-2 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# ')) return <h2 key={i} className="font-bold text-lg mt-3 mb-1">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm">{formatInline(line)}</p>
      })}
    </div>
  )
}

// ─── ErrorBoundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(70, 10%, 12%)', color: 'hsl(60, 30%, 96%)' }}>
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-sm mb-4" style={{ color: 'hsl(50, 6%, 58%)' }}>{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 text-sm font-medium"
              style={{ background: 'hsl(52, 100%, 62%)', color: 'hsl(70, 10%, 10%)', borderRadius: '0' }}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Quick Suggestion Chips ───────────────────────────────────────────────────

const FETCH_ALL_QUERY = 'List every single environment variable available on the system. Return all of them without any filter — show everything.'

const SUGGESTIONS = ['Database vars', 'API keys', 'Port configs', 'AWS credentials', 'Redis config']

// ─── Confidence Badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    high: { bg: 'hsla(80, 80%, 50%, 0.15)', text: 'hsl(80, 80%, 50%)', border: 'hsl(80, 80%, 50%)' },
    medium: { bg: 'hsla(35, 100%, 50%, 0.15)', text: 'hsl(35, 100%, 50%)', border: 'hsl(35, 100%, 50%)' },
    low: { bg: 'hsla(50, 6%, 58%, 0.15)', text: 'hsl(50, 6%, 58%)', border: 'hsl(50, 6%, 58%)' },
  }
  const c = colors[confidence] ?? colors.low
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-mono font-medium uppercase tracking-wider"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '0' }}
    >
      {confidence}
    </span>
  )
}

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} style={{ borderBottom: '1px solid hsl(70, 8%, 22%)' }}>
          <td className="px-4 py-3">
            <div className="h-4 w-40 animate-pulse" style={{ background: 'hsl(70, 10%, 26%)', borderRadius: '0' }} />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-56 animate-pulse" style={{ background: 'hsl(70, 10%, 26%)', borderRadius: '0' }} />
          </td>
          <td className="px-4 py-3">
            <div className="h-5 w-16 animate-pulse" style={{ background: 'hsl(70, 10%, 26%)', borderRadius: '0' }} />
          </td>
        </tr>
      ))}
    </>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 flex items-center justify-center mb-4" style={{ background: 'hsl(70, 10%, 20%)', border: '1px solid hsl(70, 8%, 22%)' }}>
        <FiTerminal size={28} style={{ color: 'hsl(50, 6%, 58%)' }} />
      </div>
      <p className="text-base font-medium mb-1" style={{ color: 'hsl(60, 30%, 96%)' }}>No matching variables found</p>
      <p className="text-sm text-center max-w-xs" style={{ color: 'hsl(50, 6%, 58%)' }}>
        Try a different description, for example: &quot;database credentials&quot;, &quot;all API keys&quot;, or &quot;AWS region config&quot;.
      </p>
    </div>
  )
}

// ─── Initial State (no query yet) ─────────────────────────────────────────────

function InitialState({ onFetchAll, loading }: { onFetchAll: () => void; loading: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="w-20 h-20 flex items-center justify-center mb-5" style={{ background: 'hsla(52, 100%, 62%, 0.08)', border: '1px solid hsla(52, 100%, 62%, 0.2)' }}>
        <FiZap size={32} style={{ color: 'hsl(52, 100%, 62%)' }} />
      </div>
      <p className="text-lg font-medium mb-2" style={{ color: 'hsl(60, 30%, 96%)' }}>Describe the env variable you need</p>
      <p className="text-sm text-center max-w-sm mb-5" style={{ color: 'hsl(50, 6%, 58%)' }}>
        Enter a natural-language description above to search for environment variables, or fetch everything at once.
      </p>
      <button
        onClick={onFetchAll}
        disabled={loading}
        className="flex items-center gap-2 px-6 py-3 text-sm font-mono font-semibold transition-all"
        style={{
          background: 'hsl(80, 80%, 50%)',
          color: 'hsl(70, 10%, 8%)',
          borderRadius: '0',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (!loading) e.currentTarget.style.background = 'hsl(80, 80%, 55%)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'hsl(80, 80%, 50%)'
        }}
      >
        <FiList size={16} />
        Fetch All Variables
      </button>
    </div>
  )
}

// ─── Time Formatter ───────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
  } catch {
    return ''
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Page() {
  // State
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<AgentResult | null>(null)
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [sortField, setSortField] = useState<'name' | 'confidence'>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [hasQueried, setHasQueried] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [debugInfo, setDebugInfo] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const [timestampNow, setTimestampNow] = useState('')

  // Avoid hydration mismatch for timestamps
  useEffect(() => {
    setTimestampNow(new Date().toISOString())
    const interval = setInterval(() => setTimestampNow(new Date().toISOString()), 60000)
    return () => clearInterval(interval)
  }, [])

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setHistory(parsed)
        }
      }
    } catch {
      // ignore
    }
    // Auto-focus input
    inputRef.current?.focus()
  }, [])

  // Save history to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      // ignore
    }
  }, [history])

  // Sort variables
  const sortedVariables = useCallback(() => {
    const vars = Array.isArray(results?.variables) ? [...results.variables] : []
    const confOrder: Record<string, number> = { high: 3, medium: 2, low: 1 }
    vars.sort((a, b) => {
      if (sortField === 'name') {
        const cmp = (a?.name ?? '').localeCompare(b?.name ?? '')
        return sortDirection === 'asc' ? cmp : -cmp
      } else {
        const cmp = (confOrder[a?.confidence ?? 'low'] ?? 0) - (confOrder[b?.confidence ?? 'low'] ?? 0)
        return sortDirection === 'asc' ? cmp : -cmp
      }
    })
    return vars
  }, [results, sortField, sortDirection])

  // Submit query
  const handleSubmit = useCallback(async (queryText?: string) => {
    const q = (queryText ?? query).trim()
    if (!q) return

    setLoading(true)
    setError(null)
    setResults(null)
    setHasQueried(true)
    setActiveAgentId(AGENT_ID)

    try {
      const result = await callAIAgent(q, AGENT_ID)
      setActiveAgentId(null)

      // Debug: capture raw result shape
      const debugData = {
        success: result.success,
        hasResponse: !!result.response,
        responseStatus: result.response?.status,
        resultType: typeof result.response?.result,
        resultKeys: result.response?.result && typeof result.response.result === 'object' ? Object.keys(result.response.result) : 'N/A',
        hasVariables: result.response?.result && typeof result.response.result === 'object' ? Array.isArray((result.response.result as any).variables) : false,
        variablesCount: result.response?.result && typeof result.response.result === 'object' && Array.isArray((result.response.result as any).variables) ? (result.response.result as any).variables.length : 0,
        responseMessage: result.response?.message,
        error: result.error,
        rawResponseType: typeof (result as any).raw_response,
      }
      setDebugInfo(JSON.stringify(debugData, null, 2))
      console.log('[EnvFetch] Raw API result:', JSON.stringify(result, null, 2).slice(0, 2000))

      if (!result.success) {
        const errorMsg = result?.error ?? result?.response?.message ?? 'Agent request failed. Please try again.'
        setError(errorMsg)
        return
      }

      const parsed = parseAgentResponse(result)
      console.log('[EnvFetch] Parsed result:', parsed ? { varsCount: parsed.variables.length, interp: parsed.query_interpretation?.slice(0, 50) } : 'null')

      if (parsed && (parsed.variables.length > 0 || parsed.query_interpretation)) {
        setResults(parsed)
        const historyItem: QueryHistoryItem = {
          id: Date.now().toString(),
          query: queryText ? 'Show all environment variables' : q,
          timestamp: new Date().toISOString(),
          resultCount: parsed.total_found,
        }
        setHistory(prev => [historyItem, ...prev.slice(0, 49)])
      } else {
        // Show what came back as a meaningful message
        const responseMsg = result?.response?.message
          ?? (result?.response?.result && typeof result.response.result === 'object'
            ? (result.response.result as any)?.text ?? (result.response.result as any)?.message
            : null)
          ?? result?.error
          ?? 'No matching variables found. The agent returned an empty result. Try a more specific query.'
        if (parsed && parsed.message) {
          setResults(parsed)
          const historyItem: QueryHistoryItem = {
            id: Date.now().toString(),
            query: queryText ? 'Show all environment variables' : q,
            timestamp: new Date().toISOString(),
            resultCount: 0,
          }
          setHistory(prev => [historyItem, ...prev.slice(0, 49)])
        } else {
          setError(typeof responseMsg === 'string' ? responseMsg : 'No results returned. Try a different query.')
        }
      }
    } catch (err) {
      setActiveAgentId(null)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
      setActiveAgentId(null)
    }
  }, [query])

  // Copy value to clipboard
  const handleCopy = useCallback(async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch {
      // Fallback
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    }
  }, [])

  // Toggle sort
  const handleSort = useCallback((field: 'name' | 'confidence') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }, [sortField])

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      // ignore
    }
  }, [])

  // Re-run from history
  const rerunQuery = useCallback((q: string) => {
    setQuery(q)
    handleSubmit(q)
  }, [handleSubmit])

  const sorted = sortedVariables()

  return (
    <ErrorBoundary>
      <div style={THEME_VARS} className="min-h-screen flex flex-col" >
        <div className="min-h-screen flex flex-col" style={{ background: 'hsl(70, 10%, 12%)', color: 'hsl(60, 30%, 96%)' }}>

          {/* ─── Header ──────────────────────────────────────────────────── */}
          <header
            className="flex items-center justify-between px-4 py-2 border-b shrink-0"
            style={{ background: 'hsl(70, 10%, 14%)', borderColor: 'hsl(70, 8%, 22%)', height: '48px' }}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 transition-colors lg:hidden"
                style={{ color: 'hsl(50, 6%, 58%)' }}
                aria-label="Toggle sidebar"
              >
                <FiTerminal size={18} />
              </button>
              <FiTerminal size={20} style={{ color: 'hsl(52, 100%, 62%)' }} />
              <h1 className="text-base font-bold font-mono tracking-tight" style={{ color: 'hsl(52, 100%, 62%)' }}>
                EnvFetch
              </h1>
              <span className="text-xs font-mono ml-1 hidden sm:inline" style={{ color: 'hsl(50, 6%, 58%)' }}>
                / environment variable search
              </span>
            </div>
            <div className="flex items-center gap-3">
              <FiSettings size={18} style={{ color: 'hsl(50, 6%, 58%)' }} className="cursor-pointer hover:opacity-80 transition-opacity" />
            </div>
          </header>

          {/* ─── Body ──────────────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">

            {/* ─── Sidebar ───────────────────────────────────────────── */}
            <aside
              className={`shrink-0 flex-col border-r overflow-hidden transition-all duration-200 ${sidebarOpen ? 'flex w-60' : 'hidden lg:flex lg:w-60'}`}
              style={{ background: 'hsl(70, 8%, 13%)', borderColor: 'hsl(70, 8%, 20%)' }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'hsl(70, 8%, 20%)' }}>
                <div className="flex items-center gap-1.5">
                  <FiClock size={14} style={{ color: 'hsl(50, 6%, 58%)' }} />
                  <span className="text-xs font-mono font-medium uppercase tracking-wider" style={{ color: 'hsl(50, 6%, 58%)' }}>
                    History
                  </span>
                </div>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="p-1 transition-opacity hover:opacity-100 opacity-60"
                    style={{ color: 'hsl(338, 95%, 55%)' }}
                    title="Clear history"
                  >
                    <FiTrash2 size={13} />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {history.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-xs" style={{ color: 'hsl(50, 6%, 58%)' }}>No queries yet</p>
                  </div>
                ) : (
                  <div className="py-1">
                    {history.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => rerunQuery(item.query)}
                        className="w-full text-left px-3 py-2.5 transition-colors border-b"
                        style={{ borderColor: 'hsl(70, 8%, 18%)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(70, 10%, 16%)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-mono truncate block max-w-[140px]" style={{ color: 'hsl(60, 30%, 96%)' }}>
                            {item.query}
                          </span>
                          <span
                            className="text-xs font-mono px-1.5 py-0 ml-1 shrink-0"
                            style={{ background: 'hsla(80, 80%, 50%, 0.15)', color: 'hsl(80, 80%, 50%)', borderRadius: '0' }}
                          >
                            {item.resultCount}
                          </span>
                        </div>
                        <span className="text-xs" style={{ color: 'hsl(50, 6%, 48%)' }}>
                          {timestampNow ? formatTimestamp(item.timestamp) : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* ─── Main Content ───────────────────────────────────────── */}
            <main className="flex-1 flex flex-col overflow-y-auto">

              {/* ─── Search Section ──────────────────────────────────── */}
              <div className="px-4 md:px-8 pt-6 pb-4" style={{ background: 'hsl(70, 10%, 13%)' }}>
                <div className="max-w-3xl mx-auto">
                  {/* Search bar */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <FiSearch
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ color: 'hsl(50, 6%, 58%)' }}
                      />
                      <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                        placeholder="Describe the env variable you need..."
                        maxLength={200}
                        disabled={loading}
                        className="w-full pl-10 pr-4 py-2.5 text-sm font-mono outline-none transition-colors"
                        style={{
                          background: 'hsl(70, 8%, 28%)',
                          color: 'hsl(60, 30%, 96%)',
                          border: '1px solid hsl(70, 8%, 32%)',
                          borderRadius: '0',
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'hsl(52, 100%, 62%)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'hsl(70, 8%, 32%)' }}
                      />
                    </div>
                    <button
                      onClick={() => handleSubmit()}
                      disabled={loading || !query.trim()}
                      className="px-5 py-2.5 text-sm font-mono font-semibold transition-opacity shrink-0 flex items-center gap-2"
                      style={{
                        background: loading || !query.trim() ? 'hsl(70, 10%, 26%)' : 'hsl(52, 100%, 62%)',
                        color: loading || !query.trim() ? 'hsl(50, 6%, 58%)' : 'hsl(70, 10%, 10%)',
                        borderRadius: '0',
                        cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {loading ? (
                        <>
                          <FiRefreshCw size={14} className="animate-spin" />
                          <span>Fetching...</span>
                        </>
                      ) : (
                        <>
                          <FiSearch size={14} />
                          <span>Fetch Variables</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Fetch All Button */}
                  <div className="mt-3">
                    <button
                      onClick={() => {
                        setQuery('Show all environment variables')
                        handleSubmit(FETCH_ALL_QUERY)
                      }}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-mono font-semibold transition-all"
                      style={{
                        background: 'hsla(80, 80%, 50%, 0.1)',
                        color: 'hsl(80, 80%, 50%)',
                        border: '1px solid hsl(80, 80%, 50%)',
                        borderRadius: '0',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!loading) {
                          e.currentTarget.style.background = 'hsla(80, 80%, 50%, 0.2)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'hsla(80, 80%, 50%, 0.1)'
                      }}
                    >
                      <FiList size={16} />
                      <span>Fetch All Variables (No Filter)</span>
                    </button>
                  </div>

                  {/* Helper text */}
                  <p className="mt-3 text-xs font-mono" style={{ color: 'hsl(50, 6%, 48%)' }}>
                    Or try a specific query: &quot;database credentials&quot;, &quot;all API keys&quot;, &quot;AWS region config&quot;
                  </p>

                  {/* Suggestion chips */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setQuery(s)
                          handleSubmit(s)
                        }}
                        disabled={loading}
                        className="px-3 py-1 text-xs font-mono transition-colors"
                        style={{
                          background: 'hsl(70, 10%, 20%)',
                          color: 'hsl(60, 30%, 96%)',
                          border: '1px solid hsl(70, 8%, 28%)',
                          borderRadius: '0',
                          cursor: loading ? 'not-allowed' : 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.currentTarget.style.borderColor = 'hsl(52, 100%, 62%)'
                            e.currentTarget.style.color = 'hsl(52, 100%, 62%)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'hsl(70, 8%, 28%)'
                          e.currentTarget.style.color = 'hsl(60, 30%, 96%)'
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ─── Results Area ─────────────────────────────────────── */}
              <div className="flex-1 px-4 md:px-8 py-4">
                <div className="max-w-3xl mx-auto">

                  {/* Debug Panel - temporary */}
                  {debugInfo && (
                    <details className="mb-4" style={{ border: '1px solid hsl(261, 100%, 75%)', borderRadius: '0' }}>
                      <summary className="px-3 py-2 cursor-pointer text-xs font-mono" style={{ background: 'hsl(70, 10%, 16%)', color: 'hsl(261, 100%, 75%)' }}>
                        Debug: API Response Shape
                      </summary>
                      <pre className="px-3 py-2 text-xs font-mono overflow-x-auto" style={{ background: 'hsl(70, 10%, 14%)', color: 'hsl(50, 6%, 58%)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {debugInfo}
                      </pre>
                    </details>
                  )}

                  {/* Error Banner */}
                  {error && (
                    <div
                      className="flex items-start gap-3 px-4 py-3 mb-4"
                      style={{
                        background: 'hsla(338, 95%, 55%, 0.1)',
                        border: '1px solid hsl(338, 95%, 55%)',
                        borderRadius: '0',
                      }}
                    >
                      <FiAlertCircle size={18} className="shrink-0 mt-0.5" style={{ color: 'hsl(338, 95%, 55%)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono" style={{ color: 'hsl(338, 95%, 55%)' }}>
                          {error}
                        </p>
                      </div>
                      <button
                        onClick={() => handleSubmit()}
                        className="shrink-0 flex items-center gap-1 px-3 py-1 text-xs font-mono font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'hsl(338, 95%, 55%)', color: 'hsl(60, 30%, 96%)', borderRadius: '0' }}
                      >
                        <FiRefreshCw size={12} />
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Loading State */}
                  {loading && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <FiRefreshCw size={14} className="animate-spin" style={{ color: 'hsl(52, 100%, 62%)' }} />
                        <span className="text-xs font-mono" style={{ color: 'hsl(52, 100%, 62%)' }}>
                          Searching environment variables...
                        </span>
                      </div>
                      <div style={{ border: '1px solid hsl(70, 8%, 22%)', borderRadius: '0' }}>
                        <table className="w-full">
                          <thead>
                            <tr style={{ background: 'hsl(70, 10%, 16%)', borderBottom: '1px solid hsl(70, 8%, 22%)' }}>
                              <th className="text-left px-4 py-2 text-xs font-mono uppercase tracking-wider" style={{ color: 'hsl(50, 6%, 58%)' }}>Variable Name</th>
                              <th className="text-left px-4 py-2 text-xs font-mono uppercase tracking-wider" style={{ color: 'hsl(50, 6%, 58%)' }}>Value</th>
                              <th className="text-left px-4 py-2 text-xs font-mono uppercase tracking-wider" style={{ color: 'hsl(50, 6%, 58%)' }}>Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            <SkeletonRows />
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* No query yet */}
                  {!loading && !hasQueried && !error && (
                    <InitialState
                      onFetchAll={() => {
                        setQuery('Show all environment variables')
                        handleSubmit(FETCH_ALL_QUERY)
                      }}
                      loading={loading}
                    />
                  )}

                  {/* Results */}
                  {!loading && results && (
                    <div>
                      {/* Interpretation + Stats */}
                      <div className="mb-4 p-3" style={{ background: 'hsl(70, 10%, 16%)', border: '1px solid hsl(70, 8%, 22%)', borderRadius: '0' }}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: 'hsl(50, 6%, 58%)' }}>
                              Query Interpretation
                            </p>
                            <div style={{ color: 'hsl(60, 30%, 96%)' }}>
                              {renderMarkdown(results?.query_interpretation ?? '')}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-2xl font-mono font-bold" style={{ color: 'hsl(80, 80%, 50%)' }}>
                              {results?.total_found ?? 0}
                            </p>
                            <p className="text-xs font-mono" style={{ color: 'hsl(50, 6%, 58%)' }}>found</p>
                          </div>
                        </div>
                        {results?.message && (
                          <div className="mt-2 pt-2" style={{ borderTop: '1px solid hsl(70, 8%, 22%)' }}>
                            <p className="text-xs font-mono" style={{ color: 'hsl(50, 6%, 58%)' }}>
                              {results.message}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Variables Table */}
                      {sorted.length > 0 ? (
                        <div className="overflow-x-auto" style={{ border: '1px solid hsl(70, 8%, 22%)', borderRadius: '0' }}>
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10">
                              <tr style={{ background: 'hsl(70, 10%, 16%)', borderBottom: '1px solid hsl(70, 8%, 22%)' }}>
                                <th className="text-left px-4 py-2.5">
                                  <button
                                    onClick={() => handleSort('name')}
                                    className="flex items-center gap-1 text-xs font-mono uppercase tracking-wider transition-colors hover:opacity-80"
                                    style={{ color: sortField === 'name' ? 'hsl(52, 100%, 62%)' : 'hsl(50, 6%, 58%)' }}
                                  >
                                    Variable Name
                                    {sortField === 'name' && (
                                      sortDirection === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />
                                    )}
                                  </button>
                                </th>
                                <th className="text-left px-4 py-2.5">
                                  <span className="text-xs font-mono uppercase tracking-wider" style={{ color: 'hsl(50, 6%, 58%)' }}>
                                    Value
                                  </span>
                                </th>
                                <th className="text-left px-4 py-2.5">
                                  <button
                                    onClick={() => handleSort('confidence')}
                                    className="flex items-center gap-1 text-xs font-mono uppercase tracking-wider transition-colors hover:opacity-80"
                                    style={{ color: sortField === 'confidence' ? 'hsl(52, 100%, 62%)' : 'hsl(50, 6%, 58%)' }}
                                  >
                                    Confidence
                                    {sortField === 'confidence' && (
                                      sortDirection === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />
                                    )}
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((variable, idx) => {
                                const isCopied = copiedIndex === idx
                                return (
                                  <tr
                                    key={`${variable.name}-${idx}`}
                                    style={{
                                      background: idx % 2 === 0 ? 'transparent' : 'hsl(70, 10%, 14%)',
                                      borderBottom: '1px solid hsl(70, 8%, 20%)',
                                    }}
                                    className="group"
                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(70, 10%, 18%)' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'hsl(70, 10%, 14%)' }}
                                  >
                                    {/* Variable Name */}
                                    <td className="px-4 py-2.5">
                                      <code className="text-sm font-mono font-medium" style={{ color: 'hsl(190, 81%, 67%)' }}>
                                        {variable.name}
                                      </code>
                                    </td>

                                    {/* Value - shown as-is, no masking, no truncation */}
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <code
                                          className="text-sm font-mono flex-1 min-w-0 break-all"
                                          style={{ color: 'hsl(60, 30%, 90%)' }}
                                        >
                                          {variable.value}
                                        </code>
                                        <button
                                          onClick={() => handleCopy(variable.value, idx)}
                                          className="p-1 transition-colors shrink-0 opacity-60 group-hover:opacity-100"
                                          style={{ color: isCopied ? 'hsl(80, 80%, 50%)' : 'hsl(50, 6%, 58%)' }}
                                          title="Copy value"
                                        >
                                          {isCopied ? <FiCheck size={14} /> : <FiCopy size={14} />}
                                        </button>
                                      </div>
                                    </td>

                                    {/* Confidence */}
                                    <td className="px-4 py-2.5">
                                      <ConfidenceBadge confidence={variable.confidence ?? 'low'} />
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <EmptyState />
                      )}
                    </div>
                  )}

                  {/* Queried but no results & no loading & no error */}
                  {!loading && !results && hasQueried && !error && (
                    <EmptyState />
                  )}
                </div>
              </div>

              {/* ─── Agent Status Footer ──────────────────────────────── */}
              <div
                className="shrink-0 px-4 md:px-8 py-2 border-t"
                style={{ background: 'hsl(70, 10%, 13%)', borderColor: 'hsl(70, 8%, 22%)' }}
              >
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2"
                      style={{
                        background: activeAgentId ? 'hsl(52, 100%, 62%)' : 'hsl(80, 80%, 50%)',
                        borderRadius: '0',
                        animation: activeAgentId ? 'pulse 1.5s ease-in-out infinite' : 'none',
                      }}
                    />
                    <span className="text-xs font-mono" style={{ color: 'hsl(50, 6%, 58%)' }}>
                      <FiActivity size={11} className="inline mr-1" style={{ verticalAlign: 'middle' }} />
                      EnvVar Interpreter Agent
                    </span>
                    <span className="text-xs font-mono" style={{ color: 'hsl(50, 6%, 42%)' }}>
                      {activeAgentId ? '/ processing...' : '/ idle'}
                    </span>
                  </div>
                  <span className="text-xs font-mono" style={{ color: 'hsl(50, 6%, 42%)' }}>
                    ID: {AGENT_ID.slice(0, 8)}...
                  </span>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
