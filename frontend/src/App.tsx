"use client"

import { useState } from "react"
import { ProductList } from "@/components/ProductList"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Package2 } from "lucide-react"
import { Toaster, toast } from "react-hot-toast"

const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== "undefined") {
    if (window.location.port === "5173") {
      return "http://localhost:6001";
    }
    return window.location.origin;
  }
  return "http://localhost:6001";
}
type Service = "blinkit"

interface Product {
  id: string
  name: string
  price: string
  originalPrice: string | null
  savings: string | null
  quantity: string
  deliveryTime: string
  discount: string | null
  imageUrl: string
  available: boolean
  source?: Service 
}


export default function Home() {
  const [csvProducts, setCsvProducts] = useState<Product[]>([])
  const [batchPincodes, setBatchPincodes] = useState("")
  const [batchSearchTerms, setBatchSearchTerms] = useState("")
  const [batchQuantities, setBatchQuantities] = useState("")
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchError, setBatchError] = useState("")
  const [batchFilename, setBatchFilename] = useState<string | null>(null)


  const handleBatchCsv = async () => {
    if (!batchPincodes.trim() || !batchSearchTerms.trim()) {
      toast.error("Please provide pincodes and search terms.")
              return
            }

    setBatchLoading(true)
    setBatchError("")
    setBatchFilename(null)

    try {
      const payload: Record<string, string> = {
        pincodes: batchPincodes.trim(),
        searchTerms: batchSearchTerms.trim(),
      }
      if (batchQuantities.trim()) {
        payload.quantities = batchQuantities.trim()
      }

      const res = await fetch(`${getApiBaseUrl()}/api/blinkit/batch-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        let message = "Failed to generate CSV"
        try {
          const err = text ? JSON.parse(text) : {}
          message = err.error || message
        } catch {
          if (text) {
            message = text
          }
        }
        throw new Error(`HTTP ${res.status}: ${message}`)
      }

      const data = await res.json()
      if (data.filename) {
        setBatchFilename(data.filename)
        setCsvProducts(Array.isArray(data.items) ? data.items : [])
        toast.success("CSV generated successfully.")
      } else {
        throw new Error("CSV generation completed but filename missing.")
      }
    } catch (err: any) {
      setBatchError(err.message || "Failed to generate CSV")
      toast.error(err.message || "Failed to generate CSV")
    } finally {
      setBatchLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Toaster position="top-center" reverseOrder={false} />
      <header className="bg-orange-500 text-white shadow-md sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center">
            <Package2 className="h-8 w-8 mr-2 text-white" />
            <h1 className="text-xl sm:text-2xl font-bold">quick scraper</h1>
          </div>
          <div className="flex items-center space-x-4" />
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8 flex-grow">
        <div className="mb-6 p-4 border border-slate-200 rounded-md bg-white shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Export Blinkit CSV</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Pincodes (comma separated)</label>
              <Input
                value={batchPincodes}
                onChange={(e) => setBatchPincodes(e.target.value)}
                placeholder="e.g., 575006,560024"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Search terms (comma separated)</label>
              <Input
                value={batchSearchTerms}
                onChange={(e) => setBatchSearchTerms(e.target.value)}
                placeholder="e.g., onions,tomato"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Quantities (optional)</label>
              <Input
                value={batchQuantities}
                onChange={(e) => setBatchQuantities(e.target.value)}
                placeholder="e.g., 1kg,500g"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={handleBatchCsv} disabled={batchLoading}>
              {batchLoading ? "Generating..." : "Generate CSV"}
            </Button>
            {batchFilename && (
              <Button
                variant="outline"
                onClick={() => {
                  const url = `${getApiBaseUrl()}/api/blinkit/batch-csv/${batchFilename}`
                  window.open(url, "_blank")
                }}
              >
                Download CSV
              </Button>
            )}
            {batchError && <span className="text-sm text-red-600">{batchError}</span>}
          </div>
        </div>

        <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-bold capitalize flex items-center">
              <img src="/src/assets/blinkit.png" alt="blinkit logo" className="h-6 w-auto mr-2" />
              Blinkit
                  </h2>
            <span className={`text-sm px-2 py-1 rounded ${csvProducts.length > 0 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
              {csvProducts.length} items
                  </span>
                </div>
                <ProductList 
            products={csvProducts} 
                  isCompact={true}
            serviceName="blinkit"
            isLoading={batchLoading}
            />
          </div>
      </main>
    </div>
  )
}
