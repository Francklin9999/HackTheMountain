import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 0,
})

export default client
