const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  getProducts,
  getProductBySlug,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  productValidation,
  productIdValidation,
  slugValidation,
} = require('../controllers/productController');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput, validatePagination, validateSearch } = require('../middleware/security');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const allowedDocTypes = ['application/pdf', 'application/zip', 'application/x-rar-compressed'];
  
  if (allowedImageTypes.includes(file.mimetype)) {
    cb(null, true);
  } else if (allowedDocTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipe file tidak diizinkan'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024,
  }
});

// Public routes
router.get('/', sanitizeInput, validatePagination, validateSearch, validateRequest(validatePagination.concat(validateSearch)), getProducts);
router.get('/categories', getCategories);
router.get('/:slug', sanitizeInput, slugValidation, validateRequest(slugValidation), getProductBySlug);

// Admin routes
router.use(authenticate, adminOnly, sanitizeInput);

router.post('/', upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'product_file', maxCount: 1 }
]), productValidation, validateRequest(productValidation), createProduct);

router.get('/admin/:id', productIdValidation, validateRequest(productIdValidation), getProductById);

router.put('/:id', upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'product_file', maxCount: 1 }
]), productValidation, validateRequest(productValidation), updateProduct);

router.delete('/:id', productIdValidation, validateRequest(productIdValidation), deleteProduct);

module.exports = router;
