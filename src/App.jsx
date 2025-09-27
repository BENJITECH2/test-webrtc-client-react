import { useState } from 'react'
import './App.css'
import VideoChat from './VideoChat'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <VideoChat />
    </>
  )
}

export default App
