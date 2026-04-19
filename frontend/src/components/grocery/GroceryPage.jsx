import React, { useState, useEffect, useCallback } from 'react'
import { fetchStores, fetchGroceryItems } from '../../api'
import GroceryLists from './GroceryLists'
import OnHandView from './OnHandView'
import StoreManager from './StoreManager'

const SUB_TABS = [
  { id: 'lists',   label: 'Shopping Lists' },
  { id: 'onhand',  label: 'On Hand' },
  { id: 'stores',  label: 'Stores' },
]

export default function GroceryPage() {
  const [subTab, setSubTab]           = useState('lists')
  const [stores, setStores]           = useState([])
  const [catalogItems, setCatalogItems] = useState([])

  const loadShared = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetchStores(), fetchGroceryItems()])
      setStores(s)
      setCatalogItems(c)
    } catch (err) {
      console.error('[GroceryPage] loadShared failed:', err)
    }
  }, [])

  useEffect(() => { loadShared() }, [loadShared])

  return (
    <div className="max-w-4xl mx-auto">
      {/* Sub-nav */}
      <div className="flex gap-4 mb-6 border-b border-slate-200 dark:border-slate-700">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors -mb-px
              ${subTab === t.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'lists' && (
        <GroceryLists
          stores={stores}
          catalogItems={catalogItems}
        />
      )}
      {subTab === 'onhand' && (
        <OnHandView
          catalogItems={catalogItems}
          stores={stores}
          onCatalogChange={loadShared}
        />
      )}
      {subTab === 'stores' && (
        <StoreManager
          stores={stores}
          onStoresChange={loadShared}
        />
      )}
    </div>
  )
}
