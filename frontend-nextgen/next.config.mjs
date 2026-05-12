const BACKEND_PORT = process.env.BACKEND_PORT || '8000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${BACKEND_PORT}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
