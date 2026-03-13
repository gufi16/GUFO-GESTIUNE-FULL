import { useEffect, useState } from "react"
import PageHeader from "../components/PageHeader"

const API = "http://localhost:3001"

type Department = {
  id: string
  name: string
  isActive: boolean
}

export default function DepartamentePage() {

  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    ""

  const [list,setList] = useState<Department[]>([])
  const [name,setName] = useState("")
  const [loading,setLoading] = useState(true)

  useEffect(()=>{ load() },[])

  async function load(){

    const res = await fetch(`${API}/api/v1/meta/departments`,{
      headers:{ Authorization:`Bearer ${token}` }
    })

    const data = await res.json()

    setList(data.items || [])
    setLoading(false)

  }

  async function add(){

    if(!name) return

    await fetch(`${API}/api/v1/meta/departments`,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        Authorization:`Bearer ${token}`
      },
      body:JSON.stringify({ name })
    })

    setName("")
    load()

  }

  async function toggle(d:Department){

    await fetch(`${API}/api/v1/meta/departments/${d.id}`,{
      method:"PUT",
      headers:{
        "Content-Type":"application/json",
        Authorization:`Bearer ${token}`
      },
      body:JSON.stringify({
        name:d.name,
        isActive:!d.isActive
      })
    })

    load()

  }

  async function remove(id:string){

    if(!confirm("Ștergi departamentul?")) return

    await fetch(`${API}/api/v1/meta/departments/${id}`,{
      method:"DELETE",
      headers:{ Authorization:`Bearer ${token}` }
    })

    load()

  }

  return(

    <div className="space-y-6">

      <PageHeader
        title="Departamente"
        subtitle="Organizare produse pe departamente."
      />

      <div style={card}>

        <div style={addRow}>

          <input
            placeholder="Departament"
            value={name}
            onChange={e=>setName(e.target.value)}
            style={input}
          />

          <button onClick={add} style={btnPrimary}>
            Adaugă
          </button>

        </div>

        {loading ? (
          <div>Se încarcă...</div>
        ) : (

          <table style={table}>

            <thead>
              <tr>
                <th>Departament</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>

            <tbody>

              {list.map(d=>(
                <tr key={d.id}>

                  <td>{d.name}</td>

                  <td>
                    {d.isActive ? "Activ" : "Inactiv"}
                  </td>

                  <td style={{display:"flex",gap:8}}>

                    <button
                      onClick={()=>toggle(d)}
                      style={btnSecondary}
                    >
                      {d.isActive ? "Dezactivează" : "Activează"}
                    </button>

                    <button
                      onClick={()=>remove(d.id)}
                      style={btnDanger}
                    >
                      Șterge
                    </button>

                  </td>

                </tr>
              ))}

            </tbody>

          </table>

        )}

      </div>

    </div>
  )
}

const card = {
  background:"#fff",
  border:"1px solid #e5e7eb",
  borderRadius:18,
  padding:24
}

const addRow = {
  display:"flex",
  gap:10,
  marginBottom:20
}

const input = {
  padding:"10px 12px",
  border:"1px solid #d1d5db",
  borderRadius:10,
  flex:1
}

const btnPrimary = {
  background:"#111",
  color:"#fff",
  border:"none",
  borderRadius:10,
  padding:"10px 14px",
  cursor:"pointer"
}

const btnSecondary = {
  background:"#f3f4f6",
  border:"none",
  borderRadius:8,
  padding:"6px 10px",
  cursor:"pointer"
}

const btnDanger = {
  background:"#ef4444",
  color:"#fff",
  border:"none",
  borderRadius:8,
  padding:"6px 10px",
  cursor:"pointer"
}

const table = {
  width:"100%",
  borderCollapse:"collapse"
}